import { findUserById } from '../services/users.js';

// Se monta despues de requireAuth, asi que req.session.userId ya existe.
export function requireAdmin(req, res, next) {
  const user = findUserById(req.session.userId);
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: 'No tenes permiso para acceder a esta seccion.' });
  }
  next();
}
