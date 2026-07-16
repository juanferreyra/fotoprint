import { findUserById } from '../services/users.js';

export function requireAuth(req, res, next) {
  if (!req.session.userId || !findUserById(req.session.userId)) {
    return res.status(401).json({ error: 'No autenticado.' });
  }
  next();
}
