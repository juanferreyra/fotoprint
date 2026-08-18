import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { listAllUsers, findUserById, resetPassword, deleteUser, toPublicUser } from '../services/users.js';
import * as local from '../services/local.js';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get('/users', (req, res) => {
  res.json({ users: listAllUsers().map(toPublicUser) });
});

// Dado el nombre de la carpeta local de un cliente (que es su email saneado),
// devuelve sus datos de contacto para que el admin pueda escribirle por
// WhatsApp desde el explorador. Devuelve found=false si la carpeta no
// corresponde a ninguna cuenta (por ejemplo una carpeta creada a mano).
adminRouter.get('/client-contact', (req, res) => {
  const folder = typeof req.query.folder === 'string' ? req.query.folder : '';
  if (!folder) {
    return res.status(400).json({ error: 'Falta el nombre de la carpeta.' });
  }

  const match = listAllUsers().find((u) => local.sanitizeFolderName(u.email) === folder);
  if (!match) {
    return res.json({ found: false });
  }

  res.json({
    found: true,
    email: match.email,
    nombre: match.nombre || '',
    telefono: match.telefono || '',
  });
});

adminRouter.post('/users/:id/reset-password', async (req, res) => {
  const userId = Number(req.params.id);
  const user = findUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado.' });
  }

  const password = await resetPassword(userId);
  res.json({ password });
});

adminRouter.delete('/users/:id', async (req, res) => {
  const userId = Number(req.params.id);
  if (userId === req.session.userId) {
    return res.status(400).json({ error: 'No podes eliminar tu propia cuenta.' });
  }

  const user = findUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado.' });
  }

  // Best-effort: la carpeta local vive en disco, fuera de la base de
  // datos, asi que si falla no bloqueamos el borrado de la cuenta en si.
  await local.deleteUserFolder(user.email).catch((err) => {
    console.error(`No se pudo borrar la carpeta local de ${user.email}:`, err);
  });

  deleteUser(userId);
  res.status(204).end();
});
