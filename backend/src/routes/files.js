import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as dropboxService from '../services/dropbox.js';

export const filesRouter = Router();

filesRouter.use(requireAuth);

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
