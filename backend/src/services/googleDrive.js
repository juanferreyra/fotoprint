import { google } from 'googleapis';
import { Readable } from 'node:stream';
import { config } from '../config.js';
import { getActiveConnection } from './connections.js';

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.email',
];

// access_token por conexion, cacheado en memoria del proceso (nunca en
// disco). google-auth-library refresca solo cuando expiry_date paso, asi
// que alcanza con reinyectar lo cacheado antes de cada llamada.
const tokenCache = new Map();

function createOAuthClient() {
  return new google.auth.OAuth2(
    config.googleDrive.clientId,
    config.googleDrive.clientSecret,
    config.googleDrive.redirectUri
  );
}

export function getAuthenticationUrl(state) {
  const oauth2Client = createOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // fuerza que Google mande refresh_token tambien en reconexiones
    scope: SCOPES,
    state,
  });
}

export async function exchangeCodeForToken(code) {
  const oauth2Client = createOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

export async function getAccountInfo(tokens) {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();
  return data;
}

function createClientForConnection(connection) {
  const oauth2Client = createOAuthClient();
  const cached = tokenCache.get(connection.id);
  oauth2Client.setCredentials({
    refresh_token: connection.credentials.refresh_token,
    access_token: cached?.accessToken,
    expiry_date: cached?.expiryDate,
  });
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      tokenCache.set(connection.id, {
        accessToken: tokens.access_token,
        expiryDate: tokens.expiry_date,
      });
    }
  });
  return google.drive({ version: 'v3', auth: oauth2Client });
}

export function invalidateCache(connectionId) {
  tokenCache.delete(connectionId);
}

export async function getClientForUser(userId) {
  const connection = getActiveConnection(userId);
  if (!connection || connection.provider !== 'google_drive') {
    const err = new Error('No tenes una conexion de Google Drive activa. Conectala primero en "Conectar almacenamiento".');
    err.httpStatus = 400;
    throw err;
  }
  return { client: createClientForConnection(connection), connection };
}

// Traduce errores de la API de Google (GaxiosError, con .code/.response.status
// y .response.data.error.message) a mensajes entendibles y un httpStatus.
function toFriendlyError(err) {
  if (err && err.httpStatus) return err;

  const status = err?.code ?? err?.response?.status;
  const message = err?.response?.data?.error?.message || err?.message || '';
  const lower = message.toLowerCase();

  let friendlyMessage = 'Ocurrio un error al comunicarse con Google Drive.';
  let httpStatus = 502;

  if (status === 401 || lower.includes('invalid_grant') || lower.includes('invalid credentials')) {
    friendlyMessage = 'La conexion con Google Drive vencio o fue revocada. Reconecta tu cuenta.';
    httpStatus = 401;
  } else if (status === 404) {
    friendlyMessage = 'La carpeta o archivo no existe.';
    httpStatus = 404;
  } else if (status === 403 && lower.includes('storage quota')) {
    friendlyMessage = 'No hay espacio suficiente en tu cuenta de Google Drive.';
    httpStatus = 507;
  } else if (status === 403) {
    friendlyMessage = 'No tenes permiso para hacer esa operacion en Google Drive.';
    httpStatus = 403;
  } else if (status === 429 || lower.includes('rate limit') || lower.includes('quota exceeded')) {
    friendlyMessage = 'Demasiadas solicitudes a Google Drive. Espera un momento y volve a intentar.';
    httpStatus = 429;
  }

  const friendly = new Error(friendlyMessage);
  friendly.httpStatus = httpStatus;
  friendly.driveDetail = message || String(err);
  return friendly;
}

async function withDriveClient(userId, fn) {
  let connectionId;
  try {
    const { client, connection } = await getClientForUser(userId);
    connectionId = connection.id;
    return await fn(client, connection);
  } catch (err) {
    const status = err?.code ?? err?.response?.status;
    if (status === 401 && connectionId) {
      invalidateCache(connectionId);
    }
    throw toFriendlyError(err);
  }
}

const MAX_ENTRIES = 2000;
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

// El "ref" que expone la API generica de fotoprint es, para Drive, el id
// del archivo/carpeta. La raiz se representa como '' (se traduce a 'root').
function mapEntry(file) {
  const isFolder = file.mimeType === FOLDER_MIME_TYPE;
  return {
    type: isFolder ? 'folder' : 'file',
    name: file.name,
    ref: file.id,
    size: !isFolder && file.size !== undefined ? Number(file.size) : undefined,
    serverModified: !isFolder ? file.modifiedTime : undefined,
  };
}

export async function listFolder(userId, parentRef) {
  return withDriveClient(userId, async (drive) => {
    const parentId = parentRef || 'root';
    let entries = [];
    let pageToken;

    do {
      const response = await drive.files.list({
        q: `'${parentId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)',
        pageSize: 1000,
        pageToken,
        spaces: 'drive',
      });
      entries = entries.concat(response.data.files || []);
      pageToken = response.data.nextPageToken;
    } while (pageToken && entries.length < MAX_ENTRIES);

    return entries
      .map(mapEntry)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
      });
  });
}

export async function createFolder(userId, parentRef, name) {
  return withDriveClient(userId, async (drive) => {
    const response = await drive.files.create({
      requestBody: {
        name,
        mimeType: FOLDER_MIME_TYPE,
        parents: [parentRef || 'root'],
      },
      fields: 'id, name, mimeType',
    });
    return mapEntry(response.data);
  });
}

// Sube el buffer tal cual llego del request, sin ningun procesamiento.
export async function uploadFile(userId, parentRef, name, buffer) {
  return withDriveClient(userId, async (drive) => {
    const response = await drive.files.create({
      requestBody: { name, parents: [parentRef || 'root'] },
      media: { body: Readable.from(buffer) },
      fields: 'id, name, mimeType, size',
    });
    return mapEntry(response.data);
  });
}

export async function deleteFile(userId, ref) {
  return withDriveClient(userId, async (drive) => {
    await drive.files.delete({ fileId: ref });
  });
}

export async function downloadFile(userId, ref) {
  return withDriveClient(userId, async (drive) => {
    const response = await drive.files.get(
      { fileId: ref, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    return Buffer.from(response.data);
  });
}
