import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { getActiveConnection } from '../services/connections.js';
import * as dropboxService from '../services/dropbox.js';
import * as googleDriveService from '../services/googleDrive.js';
import * as s3Service from '../services/s3.js';
import * as ftpService from '../services/ftp.js';

export const filesRouter = Router();

filesRouter.use(requireAuth);

// Cada proveedor implementa la misma interfaz:
//   listFolder(userId, parentRef) -> [{ type, name, ref, size, serverModified }]
//   createFolder(userId, parentRef, name) -> { type: 'folder', name, ref }
//   uploadFile(userId, parentRef, name, buffer) -> { type: 'file', name, ref, size }
//   deleteFile(userId, ref) -> void
// "ref" es opaco por proveedor: para Dropbox es el path, para Drive el id
// del archivo/carpeta. La raiz siempre es ''.
const PROVIDER_SERVICES = {
  dropbox: dropboxService,
  google_drive: googleDriveService,
  s3: s3Service,
  ftp: ftpService,
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
