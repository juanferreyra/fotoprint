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
    const err = new Error('No tenes una conexion de Dropbox activa. Conectala primero en "Conectar almacenamiento".');
    err.httpStatus = 400;
    throw err;
  }
  return { client: await getClientForConnection(connection), connection };
}

export function invalidateCache(connectionId) {
  accessTokenCache.delete(connectionId);
}

// Traduce errores del SDK de Dropbox (DropboxResponseError, con status HTTP y
// un cuerpo tipo { error_summary, error: {...} }) a mensajes entendibles y un
// httpStatus para devolver en la API.
function toFriendlyError(err) {
  if (err && err.httpStatus) return err; // ya es un error "amigable" nuestro

  const status = err?.status;
  const summary = err?.error?.error_summary || '';

  let message = 'Ocurrio un error al comunicarse con Dropbox.';
  let httpStatus = 502;

  if (status === 401 || summary.includes('expired_access_token') || summary.includes('invalid_access_token')) {
    message = 'La conexion con Dropbox vencio o fue revocada. Reconecta tu cuenta.';
    httpStatus = 401;
  } else if (summary.startsWith('path/not_found') || summary.includes('path_lookup/not_found')) {
    message = 'La carpeta no existe.';
    httpStatus = 404;
  } else if (summary.startsWith('path/conflict')) {
    message = 'Ya existe un archivo o carpeta con ese nombre.';
    httpStatus = 409;
  } else if (status === 429 || summary.includes('too_many_requests') || summary.includes('rate_limit')) {
    message = 'Demasiadas solicitudes a Dropbox. Espera un momento y volve a intentar.';
    httpStatus = 429;
  } else if (summary.includes('insufficient_space')) {
    message = 'No hay espacio suficiente en tu cuenta de Dropbox.';
    httpStatus = 507;
  } else if (summary.includes('disallowed_name') || summary.includes('malformed_path')) {
    message = 'Ese nombre de archivo o carpeta no es valido para Dropbox.';
    httpStatus = 400;
  } else if (summary.includes('payload_too_large')) {
    message = 'El archivo supera el limite de 150MB para subida directa.';
    httpStatus = 413;
  }

  const friendly = new Error(message);
  friendly.httpStatus = httpStatus;
  friendly.dropboxSummary = summary || String(err);
  return friendly;
}

async function withDropboxClient(userId, fn) {
  let connectionId;
  try {
    const { client, connection } = await getClientForUser(userId);
    connectionId = connection.id;
    return await fn(client, connection);
  } catch (err) {
    if (err?.status === 401 && connectionId) {
      invalidateCache(connectionId);
    }
    throw toFriendlyError(err);
  }
}

const MAX_ENTRIES = 2000;

function mapEntry(entry) {
  return {
    type: entry['.tag'],
    name: entry.name,
    path: entry.path_display,
    size: entry['.tag'] === 'file' ? entry.size : undefined,
    serverModified: entry['.tag'] === 'file' ? entry.server_modified : undefined,
  };
}

export async function listFolder(userId, folderPath) {
  return withDropboxClient(userId, async (client) => {
    const response = await client.filesListFolder({
      path: folderPath,
      include_non_downloadable_files: true,
    });
    let { entries, cursor, has_more: hasMore } = response.result;

    while (hasMore && entries.length < MAX_ENTRIES) {
      const contResponse = await client.filesListFolderContinue({ cursor });
      entries = entries.concat(contResponse.result.entries);
      cursor = contResponse.result.cursor;
      hasMore = contResponse.result.has_more;
    }

    return entries
      .filter((entry) => entry['.tag'] === 'file' || entry['.tag'] === 'folder')
      .map(mapEntry)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
      });
  });
}

export async function createFolder(userId, folderPath) {
  return withDropboxClient(userId, async (client) => {
    const response = await client.filesCreateFolderV2({ path: folderPath });
    return mapEntry({ '.tag': 'folder', ...response.result.metadata });
  });
}

// Sube el buffer tal cual llego del request, sin ningun procesamiento.
// autorename evita pisar un archivo existente con el mismo nombre.
export async function uploadFile(userId, filePath, buffer) {
  return withDropboxClient(userId, async (client) => {
    const response = await client.filesUpload({
      path: filePath,
      contents: buffer,
      mode: { '.tag': 'add' },
      autorename: true,
      mute: false,
    });
    return mapEntry({ '.tag': 'file', ...response.result });
  });
}

export async function deleteFile(userId, filePath) {
  return withDropboxClient(userId, async (client) => {
    await client.filesDeleteV2({ path: filePath });
  });
}
