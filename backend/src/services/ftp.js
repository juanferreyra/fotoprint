import { Client, FileType } from 'basic-ftp';
import { Readable } from 'node:stream';
import { getActiveConnection } from './connections.js';

// Si el host no responde (caido, firewall, host/puerto mal escrito), no
// queremos que el pedido quede colgado para siempre.
const CONNECT_TIMEOUT_MS = 15000;

// A diferencia de Dropbox/Drive/S3, aca no cacheamos ningun cliente entre
// requests: FTP es un protocolo con estado (conexion + sesion de login), y
// muchos hostings compartidos limitan la cantidad de conexiones FTP
// simultaneas. Es mas simple y mas robusto abrir una conexion nueva para
// cada operacion y cerrarla apenas termina.
async function withFtpClient(userId, fn) {
  const connection = getActiveConnection(userId);
  if (!connection || connection.provider !== 'ftp') {
    const err = new Error('No tenes una conexion FTP activa. Conectala primero en "Conectar almacenamiento".');
    err.httpStatus = 400;
    throw err;
  }

  const client = new Client(CONNECT_TIMEOUT_MS);
  try {
    const { host, port, user, password, secure } = connection.credentials;
    await client.access({ host, port, user, password, secure });
    return await fn(client);
  } catch (err) {
    throw toFriendlyError(err);
  } finally {
    client.close();
  }
}

// Prueba que las credenciales/host sean validos antes de guardarlos.
export async function testCredentials({ host, port, user, password, secure }) {
  const client = new Client(CONNECT_TIMEOUT_MS);
  try {
    await client.access({ host, port, user, password, secure });
    await client.list('/');
  } catch (err) {
    throw toFriendlyError(err);
  } finally {
    client.close();
  }
}

// Traduce errores de basic-ftp (FTPError con .code = codigo de respuesta
// FTP, o errores de red de Node con .code tipo 'ENOTFOUND') a mensajes
// entendibles y un httpStatus.
function toFriendlyError(err) {
  if (err && err.httpStatus) return err;

  const code = err?.code;
  const lowerMessage = String(err?.message || '').toLowerCase();

  let message = 'Ocurrio un error al comunicarse con el servidor FTP.';
  let httpStatus = 502;

  if (code === 530) {
    message = 'Usuario o contrasena de FTP incorrectos.';
    httpStatus = 401;
  } else if (code === 550) {
    message = 'La carpeta o archivo no existe, o no tenes permiso para esa operacion.';
    httpStatus = 404;
  } else if (code === 553) {
    message = 'Ese nombre de archivo o carpeta no esta permitido por el servidor FTP.';
    httpStatus = 400;
  } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    message = 'No se encontro el servidor FTP. Revisa el host.';
    httpStatus = 400;
  } else if (code === 'ECONNREFUSED') {
    message = 'El servidor FTP rechazo la conexion. Revisa el puerto.';
    httpStatus = 400;
  } else if (code === 'ETIMEDOUT' || lowerMessage.includes('timeout')) {
    message = 'Tiempo de espera agotado conectando al servidor FTP.';
    httpStatus = 504;
  }

  const friendly = new Error(message);
  friendly.httpStatus = httpStatus;
  friendly.ftpDetail = err?.message || String(err);
  return friendly;
}

// La raiz es '' (equivale a "/" en el servidor FTP, que para hosting
// compartido suele ser el home de la cuenta). Las "carpetas" en FTP son
// reales (a diferencia de S3/Drive), asi que el ref es directamente el
// path completo, igual que en Dropbox.
function toRemotePath(ref) {
  return ref === '' ? '/' : ref;
}

function joinPath(parentRef, name) {
  const base = parentRef === '' ? '' : parentRef;
  return `${base}/${name}`.replace(/\/+/g, '/');
}

function mapEntry(parentRef, item) {
  const isDir = item.type === FileType.Directory;
  return {
    type: isDir ? 'folder' : 'file',
    name: item.name,
    ref: joinPath(parentRef, item.name),
    size: isDir ? undefined : item.size,
    serverModified: !isDir && item.rawModifiedAt ? item.rawModifiedAt : undefined,
  };
}

export async function listFolder(userId, parentRef) {
  return withFtpClient(userId, async (client) => {
    const list = await client.list(toRemotePath(parentRef));
    return list
      .filter((item) => item.type === FileType.Directory || item.type === FileType.File)
      .map((item) => mapEntry(parentRef, item))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
      });
  });
}

export async function createFolder(userId, parentRef, name) {
  return withFtpClient(userId, async (client) => {
    const ref = joinPath(parentRef, name);
    await client.send(`MKD ${ref}`);
    return { type: 'folder', name, ref };
  });
}

// Sube el buffer tal cual llego del request, sin ningun procesamiento.
export async function uploadFile(userId, parentRef, name, buffer) {
  return withFtpClient(userId, async (client) => {
    const ref = joinPath(parentRef, name);
    await client.uploadFrom(Readable.from(buffer), ref);
    const size = await client.size(ref);
    return { type: 'file', name, ref, size };
  });
}

export async function deleteFile(userId, ref) {
  return withFtpClient(userId, async (client) => {
    await client.remove(ref);
  });
}
