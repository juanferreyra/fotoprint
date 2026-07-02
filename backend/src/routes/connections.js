import { Router } from 'express';
import crypto from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import {
  listConnections,
  activateConnection,
  deleteConnection,
  saveConnection,
} from '../services/connections.js';
import * as dropbox from '../services/dropbox.js';

export const connectionsRouter = Router();

const PROVIDERS = new Set(['dropbox', 'google_drive', 's3']);

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

    saveConnection(req.session.userId, 'dropbox', account.email || account.name?.display_name || 'Dropbox', {
      refresh_token: tokenResult.refresh_token,
      account_id: tokenResult.account_id,
    });

    res.redirect('/connect.html?connected=dropbox');
  } catch (err) {
    console.error('Error en callback de Dropbox OAuth:', err);
    res.redirect(`/connect.html?error=${encodeURIComponent('No se pudo completar la conexion con Dropbox.')}`);
  }
});
