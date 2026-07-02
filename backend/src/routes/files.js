import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import * as dropboxService from '../services/dropbox.js';

export const filesRouter = Router();

filesRouter.use(requireAuth);

// Limite de subida en un solo request de Dropbox (filesUpload no soporta mas).
// Archivos mas grandes necesitarian upload sessions (fuera de alcance por ahora).
const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

// Buffer en memoria (RAM), nunca se escribe a disco. El buffer se manda
// tal cual llega al SDK de Dropbox, sin ningun procesamiento de imagen.
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

// Normaliza el path que manda el frontend al formato que espera Dropbox:
// '' para la raiz, o '/Carpeta/Subcarpeta' (sin barra final).
function normalizePath(raw) {
  if (raw === undefined || raw === null || raw === '' || raw === '/') return '';
  const value = String(raw).trim();
  if (value.includes('..')) throw badRequest('Ruta invalida.');
  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.replace(/\/+$/, '');
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
    const path = normalizePath(req.query.path);
    const entries = await dropboxService.listFolder(req.session.userId, path);
    res.json({ path, entries });
  } catch (err) {
    handleError(err, res);
  }
});

filesRouter.post('/folders', async (req, res) => {
  try {
    const path = normalizePath(req.body?.path);
    const name = validateFolderName(req.body?.name);
    const newPath = path === '' ? `/${name}` : `${path}/${name}`;
    const folder = await dropboxService.createFolder(req.session.userId, newPath);
    res.status(201).json({ folder });
  } catch (err) {
    handleError(err, res);
  }
});

filesRouter.post('/upload', async (req, res) => {
  try {
    await uploadSingleFile(req, res);
    if (!req.file) throw badRequest('No se recibio ningun archivo.');

    const path = normalizePath(req.body?.path);
    const name = sanitizeFileName(req.file.originalname);
    const destPath = path === '' ? `/${name}` : `${path}/${name}`;

    const uploaded = await dropboxService.uploadFile(req.session.userId, destPath, req.file.buffer);

    // Chequeo de integridad: el tamano que Dropbox confirma haber guardado
    // tiene que coincidir exactamente con el tamano del archivo original.
    if (uploaded.size !== req.file.size) {
      await dropboxService.deleteFile(req.session.userId, uploaded.path).catch(() => {});
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
