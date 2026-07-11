import { Router } from 'express';
import { createUser, findUserByEmail, verifyPassword, toPublicUser, findUserById } from '../services/users.js';
import { saveConnection } from '../services/connections.js';
import * as local from '../services/local.js';

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

authRouter.post('/register', async (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Email invalido.' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'La contrasena debe tener al menos 8 caracteres.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (findUserByEmail(normalizedEmail)) {
    return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
  }

  const user = await createUser(normalizedEmail, password);
  req.session.userId = user.id;

  // La carpeta local del proyecto queda activada por defecto para cuentas
  // nuevas, asi el usuario ya tiene donde subir fotos sin tener que pasar
  // primero por "Conectar almacenamiento". Si por algun motivo no se puede
  // crear (permisos del filesystem), no bloqueamos el registro: la cuenta
  // se crea igual y el usuario puede conectar un proveedor a mano despues.
  try {
    await local.testCredentials();
    saveConnection(user.id, 'local', local.ACCOUNT_LABEL, {});
  } catch (err) {
    console.error('No se pudo activar la carpeta local por defecto:', err);
  }

  res.status(201).json({ user: toPublicUser(user) });
});

authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email y contrasena son requeridos.' });
  }

  const user = findUserByEmail(email.trim().toLowerCase());
  if (!user || !(await verifyPassword(user, password))) {
    return res.status(401).json({ error: 'Email o contrasena incorrectos.' });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'No se pudo iniciar sesion.' });
    req.session.userId = user.id;
    res.json({ user: toPublicUser(user) });
  });
});

authRouter.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'No se pudo cerrar sesion.' });
    res.clearCookie('kodaktienda.sid');
    res.status(204).end();
  });
});

authRouter.get('/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'No autenticado.' });
  }
  const user = findUserById(req.session.userId);
  if (!user) {
    return res.status(401).json({ error: 'No autenticado.' });
  }
  res.json({ user: toPublicUser(user) });
});
