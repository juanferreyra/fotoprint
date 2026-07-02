import { Router } from 'express';
import crypto from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import {
  listConnections,
  activateConnection,
  deleteConnection,
  saveConnection,
  getConnection,
} from '../services/connections.js';
import * as dropbox from '../services/dropbox.js';
import * as googleDrive from '../services/googleDrive.js';
import * as s3 from '../services/s3.js';
import * as ftp from '../services/ftp.js';

export const connectionsRouter = Router();

const PROVIDERS = new Set(['dropbox', 'google_drive', 's3', 'ftp']);

connectionsRouter.use(requireAuth);

connectionsRouter.get('/', (req, res) => {
  res.json({ connections: listConnections(req.session.userId) });
});

connectionsRouter.post('/:provider/activate', (req, res) => {
  const { provider } = req.params;
  if (!PROVIDERS.has(provider)) {
    return res.status(400).json({ error: 'Proveedor invalido.' });
  }
  const ok = activateConnection(req.session.userId, provider);
  if (!ok) {
    return res.status(404).json({ error: 'No tenes esa conexion configurada.' });
  }
  res.json({ connections: listConnections(req.session.userId) });
});

connectionsRouter.delete('/:provider', (req, res) => {
  const { provider } = req.params;
  if (!PROVIDERS.has(provider)) {
    return res.status(400).json({ error: 'Proveedor invalido.' });
  }
  deleteConnection(req.session.userId, provider);
  res.json({ connections: listConnections(req.session.userId) });
});

// --- Dropbox OAuth ---

connectionsRouter.get('/dropbox/start', async (req, res, next) => {
  try {
    const state = crypto.randomBytes(24).toString('hex');
    req.session.dropboxOAuthState = state;
    const url = await dropbox.getAuthenticationUrl(state);
    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

connectionsRouter.get('/dropbox/callback', async (req, res, next) => {
  const { state, code, error: oauthError } = req.query;
  const expectedState = req.session.dropboxOAuthState;
  delete req.session.dropboxOAuthState;

  if (oauthError) {
    return res.redirect(`/connect.html?error=${encodeURIComponent('Autorizacion cancelada en Dropbox.')}`);
  }
  if (!state || !expectedState || state !== expectedState) {
    return res.redirect(`/connect.html?error=${encodeURIComponent('El pedido de conexion expiro o es invalido. Proba de nuevo.')}`);
  }
  if (typeof code !== 'string') {
    return res.redirect(`/connect.html?error=${encodeURIComponent('Dropbox no devolvio un codigo de autorizacion.')}`);
  }

  try {
    const tokenResult = await dropbox.exchangeCodeForToken(code);
    const account = await dropbox.getAccountInfo(tokenResult.access_token);

    // Si ya habia una conexion de Dropbox, esto la actualiza en el mismo
    // registro (mismo id). Invalidamos el access_token cacheado para esa
    // conexion, sino seguiria usando el token de la cuenta anterior hasta
    // que venza.
    const existing = getConnection(req.session.userId, 'dropbox');
    saveConnection(req.session.userId, 'dropbox', account.email || account.name?.display_name || 'Dropbox', {
      refresh_token: tokenResult.refresh_token,
      account_id: tokenResult.account_id,
    });
    if (existing) dropbox.invalidateCache(existing.id);

    res.redirect('/connect.html?connected=dropbox');
  } catch (err) {
    console.error('Error en callback de Dropbox OAuth:', err);
    res.redirect(`/connect.html?error=${encodeURIComponent('No se pudo completar la conexion con Dropbox.')}`);
  }
});

// --- Google Drive OAuth ---

connectionsRouter.get('/google_drive/start', (req, res) => {
  const state = crypto.randomBytes(24).toString('hex');
  req.session.googleDriveOAuthState = state;
  const url = googleDrive.getAuthenticationUrl(state);
  res.redirect(url);
});

connectionsRouter.get('/google_drive/callback', async (req, res) => {
  const { state, code, error: oauthError } = req.query;
  const expectedState = req.session.googleDriveOAuthState;
  delete req.session.googleDriveOAuthState;

  if (oauthError) {
    return res.redirect(`/connect.html?error=${encodeURIComponent('Autorizacion cancelada en Google.')}`);
  }
  if (!state || !expectedState || state !== expectedState) {
    return res.redirect(`/connect.html?error=${encodeURIComponent('El pedido de conexion expiro o es invalido. Proba de nuevo.')}`);
  }
  if (typeof code !== 'string') {
    return res.redirect(`/connect.html?error=${encodeURIComponent('Google no devolvio un codigo de autorizacion.')}`);
  }

  try {
    const tokens = await googleDrive.exchangeCodeForToken(code);
    if (!tokens.refresh_token) {
      return res.redirect(
        `/connect.html?error=${encodeURIComponent('Google no devolvio un refresh token. Revoca el acceso de fotoprint en myaccount.google.com/permissions y proba de nuevo.')}`
      );
    }

    const account = await googleDrive.getAccountInfo(tokens);

    const existing = getConnection(req.session.userId, 'google_drive');
    saveConnection(req.session.userId, 'google_drive', account.email || 'Google Drive', {
      refresh_token: tokens.refresh_token,
    });
    if (existing) googleDrive.invalidateCache(existing.id);

    res.redirect('/connect.html?connected=google_drive');
  } catch (err) {
    console.error('Error en callback de Google Drive OAuth:', err);
    res.redirect(`/connect.html?error=${encodeURIComponent('No se pudo completar la conexion con Google Drive.')}`);
  }
});

// --- Amazon S3 (formulario de credenciales, sin OAuth) ---

connectionsRouter.post('/s3', async (req, res) => {
  const { accessKeyId, secretAccessKey, bucket, region } = req.body || {};
  const fields = { accessKeyId, secretAccessKey, bucket, region };
  const missing = Object.entries(fields).filter(([, value]) => typeof value !== 'string' || !value.trim());

  if (missing.length > 0) {
    return res.status(400).json({ error: 'Access key, secret key, bucket y region son requeridos.' });
  }

  const credentials = {
    accessKeyId: accessKeyId.trim(),
    secretAccessKey: secretAccessKey.trim(),
    bucket: bucket.trim(),
    region: region.trim(),
  };

  try {
    // Probamos las credenciales contra el bucket real antes de guardar,
    // para no dejar guardada una conexion rota por un typo.
    await s3.testCredentials(credentials);
  } catch (err) {
    return res.status(err.httpStatus || 502).json({ error: err.message });
  }

  const existing = getConnection(req.session.userId, 's3');
  saveConnection(req.session.userId, 's3', `${credentials.bucket} (${credentials.region})`, credentials);
  if (existing) s3.invalidateCache(existing.id);

  res.status(201).json({ connections: listConnections(req.session.userId) });
});

// --- FTP (formulario de credenciales, sin OAuth) ---

connectionsRouter.post('/ftp', async (req, res) => {
  const { host, user, password } = req.body || {};
  const port = req.body?.port === undefined || req.body?.port === '' ? 21 : Number(req.body.port);
  const secure = Boolean(req.body?.secure);

  const requiredFields = { host, user, password };
  const missing = Object.entries(requiredFields).filter(([, value]) => typeof value !== 'string' || !value.trim());

  if (missing.length > 0 || !Number.isInteger(port) || port < 1 || port > 65535) {
    return res.status(400).json({ error: 'Host, usuario, contrasena y un puerto valido son requeridos.' });
  }

  const credentials = {
    host: host.trim(),
    port,
    user: user.trim(),
    password,
    secure,
  };

  try {
    // Probamos las credenciales contra el servidor real antes de guardar,
    // para no dejar guardada una conexion rota por un typo.
    await ftp.testCredentials(credentials);
  } catch (err) {
    return res.status(err.httpStatus || 502).json({ error: err.message });
  }

  // FTP no cachea ningun cliente por conexion (services/ftp.js abre una
  // conexion nueva en cada operacion), asi que reconectar con credenciales
  // distintas no deja nada desactualizado para invalidar.
  saveConnection(req.session.userId, 'ftp', `${credentials.user}@${credentials.host}`, credentials);

  res.status(201).json({ connections: listConnections(req.session.userId) });
});
