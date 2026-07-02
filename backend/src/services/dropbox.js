import { Dropbox, DropboxAuth } from 'dropbox';
import { config } from '../config.js';
import { getActiveConnection } from './connections.js';

// access_token de Dropbox por conexion, cacheado en memoria del proceso
// (nunca en disco). Se refresca con el refresh_token cuando falta o esta por vencer.
const accessTokenCache = new Map();

function createAuthClient() {
  return new DropboxAuth({
    clientId: config.dropbox.appKey,
    clientSecret: config.dropbox.appSecret,
  });
}

export async function getAuthenticationUrl(state) {
  const auth = createAuthClient();
  return auth.getAuthenticationUrl(
    config.dropbox.redirectUri,
    state,
    'code',
    'offline',
    undefined,
    'none',
    false
  );
}

export async function exchangeCodeForToken(code) {
  const auth = createAuthClient();
  const response = await auth.getAccessTokenFromCode(config.dropbox.redirectUri, code);
  return response.result;
}

export async function getAccountInfo(accessToken) {
  const client = new Dropbox({ accessToken });
  const response = await client.usersGetCurrentAccount();
  return response.result;
}

async function refreshClientForConnection(connection) {
  const auth = createAuthClient();
  auth.setRefreshToken(connection.credentials.refresh_token);
  await auth.refreshAccessToken();
  const accessToken = auth.getAccessToken();
  // Los access tokens de Dropbox duran ~4hs; guardamos margen para refrescar antes de tiempo.
  const expiresAt = Date.now() + 3.5 * 60 * 60 * 1000;
  accessTokenCache.set(connection.id, { accessToken, expiresAt });
  return accessToken;
}

export async function getClientForConnection(connection) {
  const cached = accessTokenCache.get(connection.id);
  const accessToken =
    cached && cached.expiresAt > Date.now()
      ? cached.accessToken
      : await refreshClientForConnection(connection);
  return new Dropbox({ accessToken });
}

export async function getClientForUser(userId) {
  const connection = getActiveConnection(userId);
  if (!connection || connection.provider !== 'dropbox') {
    const err = new Error('No hay una conexion de Dropbox activa.');
    err.code = 'NO_ACTIVE_CONNECTION';
    throw err;
  }
  return { client: await getClientForConnection(connection), connection };
}

export function invalidateCache(connectionId) {
  accessTokenCache.delete(connectionId);
}
