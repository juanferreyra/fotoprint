import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { listAllUsers, findUserById, resetPassword, toPublicUser } from '../services/users.js';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get('/users', (req, res) => {
  res.json({ users: listAllUsers().map(toPublicUser) });
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
