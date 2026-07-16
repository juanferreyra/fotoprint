import { Router } from 'express';
import multer from 'multer';
import { ZipArchive } from 'archiver';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { getActiveConnection } from '../services/connections.js';
import * as dropboxService from '../services/dropbox.js';
import * as googleDriveService from '../services/googleDrive.js';
import * as s3Service from '../services/s3.js';
import * as ftpService from '../services/ftp.js';
import * as localService from '../services/local.js';

export const filesRouter = Router();

filesRouter.use(requireAuth);

// Cada proveedor implementa la misma interfaz:
//   listFolder(userId, parentRef) -> [{ type, name, ref, size, serverModified }]
//   createFolder(userId, parentRef, name) -> { type: 'folder', name, ref }
//   uploadFile(userId, parentRef, name, buffer) -> { type: 'file', name, ref, size }
//   deleteFile(userId, ref) -> void
//   deleteFolder(userId, ref) -> void
//   downloadFile(userId, ref) -> Buffer
// "ref" es opaco por proveedor: para Dropbox es el path, para Drive el id
// del archivo/carpeta. La raiz siempre es ''.
const PROVIDER_SERVICES = {
  dropbox: dropboxService,
  google_drive: googleDriveService,
  s3: s3Service,
  ftp: ftpService,
  local: localService,
};

// Limite de subida en un solo request (coincide con el limite de Dropbox
// para filesUpload; lo reutilizamos tambien para Drive por simplicidad).
// Archivos mas grandes necesitarian upload sessions/resumable uploads,
// fuera de alcance por ahora.
const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

// Buffer en memoria (RAM), nunca se escribe a disco. El buffer se manda tal
// cual llega al SDK del proveedor, sin ningun procesamiento de imagen.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

function uploadSingleFile(req, res) {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, (err) => (err ? reject(err) : resolve()));
  });
}

function badRequest(message) {
  const err = new Error(message);
  err.httpStatus = 400;
  return err;
}

function getProviderService(userId) {
  const connection = getActiveConnection(userId);
  const service = connection && PROVIDER_SERVICES[connection.provider];
  if (!service) {
    throw badRequest('No tenes ninguna conexion de almacenamiento activa. Conectala primero en "Conectar almacenamiento".');
  }
  return service;
}

function normalizeRef(raw) {
  if (raw === undefined || raw === null) return '';
  const value = String(raw).trim();
  if (value.includes('..')) throw badRequest('Referencia de carpeta invalida.');
  return value;
}

function validateFolderName(name) {
  if (typeof name !== 'string') throw badRequest('El nombre de la carpeta es requerido.');
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 255 || /[/\\]/.test(trimmed)) {
    throw badRequest('Nombre de carpeta invalido.');
  }
  return trimmed;
}

// El nombre original del archivo puede traer una ruta si el navegador la
// incluyo; nos quedamos solo con el nombre de archivo.
function sanitizeFileName(name) {
  if (typeof name !== 'string') throw badRequest('Nombre de archivo invalido.');
  const base = name.replace(/^.*[/\\]/, '').trim();
  if (!base || base.length > 255) throw badRequest('Nombre de archivo invalido.');
  return base;
}

// Solo se usa para la vista previa inline (miniatura + lightbox) en
// el explorador. Fuera de esta lista, la descarga cae en
// application/octet-stream (no hay forma sensata de previsualizar inline
// un archivo que no sea imagen, y la descarga normal no necesita esto).
const IMAGE_MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
};

function imageMimeType(name) {
  const ext = name.includes('.') ? `.${name.split('.').pop().toLowerCase()}` : '';
  return IMAGE_MIME_TYPES[ext];
}

function handleError(err, res) {
  if (err.httpStatus) {
    return res.status(err.httpStatus).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
}

filesRouter.get('/', async (req, res) => {
  try {
    const service = getProviderService(req.session.userId);
    const parent = normalizeRef(req.query.parent);
    const entries = await service.listFolder(req.session.userId, parent);
    res.json({ parent, entries });
  } catch (err) {
    handleError(err, res);
  }
});

filesRouter.get('/download', async (req, res) => {
  try {
    const service = getProviderService(req.session.userId);
    const ref = normalizeRef(req.query.ref);
    if (!ref) throw badRequest('Falta indicar que archivo descargar.');
    const name = sanitizeFileName(req.query.name);

    const buffer = await service.downloadFile(req.session.userId, ref);

    // inline=1 es lo que usan la miniatura y el lightbox del explorador
    // para mostrar la imagen en la pagina en vez de forzar la descarga.
    // Sin inline (o si el archivo no es una imagen conocida), se manda
    // como attachment para forzar la descarga, igual que siempre.
    const mimeType = req.query.inline === '1' ? imageMimeType(name) : undefined;
    const disposition = mimeType ? 'inline' : 'attachment';

    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    // filename para navegadores viejos + filename* (RFC 5987) para que los
    // nombres con acentos/espacios/caracteres no ASCII se guarden bien.
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${name.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`
    );
    res.send(buffer);
  } catch (err) {
    handleError(err, res);
  }
});

filesRouter.delete('/', async (req, res) => {
  try {
    const service = getProviderService(req.session.userId);
    const ref = normalizeRef(req.query.ref);
    if (!ref) throw badRequest('Falta indicar que archivo eliminar.');
    await service.deleteFile(req.session.userId, ref);
    res.status(204).end();
  } catch (err) {
    handleError(err, res);
  }
});

// Solo la cuenta admin puede borrar carpetas (un usuario regular puede
// borrar fotos de su propia carpeta con DELETE / de arriba, pero no
// carpetas enteras, ni siquiera las suyas).
filesRouter.delete('/folders', requireAdmin, async (req, res) => {
  try {
    const service = getProviderService(req.session.userId);
    const ref = normalizeRef(req.query.ref);
    if (!ref) throw badRequest('No se puede eliminar la carpeta raiz.');
    await service.deleteFolder(req.session.userId, ref);
    res.status(204).end();
  } catch (err) {
    handleError(err, res);
  }
});

// Junta recursivamente todo el contenido de una carpeta (subcarpetas
// incluidas) dentro del archive, usando solo listFolder/downloadFile —
// no hace falta que ningun proveedor implemente nada especial para esto.
// basePath es la ruta dentro del zip (no el ref del proveedor).
async function addFolderToArchive(service, userId, ref, basePath, archive) {
  const entries = await service.listFolder(userId, ref);
  for (const entry of entries) {
    const entryPath = `${basePath}/${entry.name}`;
    if (entry.type === 'folder') {
      await addFolderToArchive(service, userId, entry.ref, entryPath, archive);
    } else {
      const buffer = await service.downloadFile(userId, entry.ref);
      archive.append(buffer, { name: entryPath });
    }
  }
}

// Descarga zipeada de varios archivos/carpetas juntos: seleccion manual
// desde el explorador, o el contenido completo de una carpeta con un solo
// click. Solo para el admin (routes/files.js documenta por que borrar/ver
// todo ya es admin-only; empaquetar todo junto tiene el mismo criterio).
filesRouter.post('/download-zip', requireAdmin, async (req, res) => {
  let items;
  try {
    const service = getProviderService(req.session.userId);
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (rawItems.length === 0) throw badRequest('No se selecciono nada para descargar.');

    items = rawItems.map((item) => ({
      ref: normalizeRef(item.ref),
      name: sanitizeFileName(item.name),
      type: item.type === 'folder' ? 'folder' : 'file',
    }));

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="descarga.zip"');

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', (err) => console.error('Error generando el zip:', err));
    archive.pipe(res);

    for (const item of items) {
      try {
        if (item.type === 'folder') {
          await addFolderToArchive(service, req.session.userId, item.ref, item.name, archive);
        } else {
          const buffer = await service.downloadFile(req.session.userId, item.ref);
          archive.append(buffer, { name: item.name });
        }
      } catch (err) {
        // Un archivo que falla (borrado mientras tanto, error de red, etc.)
        // no tiene que arruinar el zip entero: se salta y sigue con el resto.
        console.error(`No se pudo agregar "${item.name}" al zip:`, err);
      }
    }

    await archive.finalize();
  } catch (err) {
    // Si ya empezamos a mandar el zip (headers enviados), no podemos
    // mandar un JSON de error limpio; solo cortar la respuesta.
    if (res.headersSent) {
      res.end();
      return;
    }
    handleError(err, res);
  }
});

filesRouter.post('/folders', async (req, res) => {
  try {
    const service = getProviderService(req.session.userId);
    const parent = normalizeRef(req.body?.parent);
    const name = validateFolderName(req.body?.name);
    const folder = await service.createFolder(req.session.userId, parent, name);
    res.status(201).json({ folder });
  } catch (err) {
    handleError(err, res);
  }
});

filesRouter.post('/upload', async (req, res) => {
  try {
    await uploadSingleFile(req, res);
    if (!req.file) throw badRequest('No se recibio ningun archivo.');

    const service = getProviderService(req.session.userId);
    const parent = normalizeRef(req.body?.parent);
    const name = sanitizeFileName(req.file.originalname);

    const uploaded = await service.uploadFile(req.session.userId, parent, name, req.file.buffer);

    // Chequeo de integridad: el tamano que el proveedor confirma haber
    // guardado tiene que coincidir exactamente con el del archivo original.
    if (uploaded.size !== req.file.size) {
      await service.deleteFile(req.session.userId, uploaded.ref).catch(() => {});
      throw Object.assign(
        new Error('La subida se completo pero el tamano no coincidio con el original. Se elimino el archivo, proba de nuevo.'),
        { httpStatus: 502 }
      );
    }

    res.status(201).json({ file: uploaded });
  } catch (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'El archivo supera el limite de 150MB para subida directa.' });
      }
      return res.status(400).json({ error: 'Error al procesar el archivo subido.' });
    }
    handleError(err, res);
  }
});
