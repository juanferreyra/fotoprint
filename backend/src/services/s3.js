import {
  S3Client,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getActiveConnection } from './connections.js';

// Cliente S3 por conexion, cacheado en memoria del proceso (nunca en
// disco). Las credenciales de S3 (a diferencia de Dropbox/Drive) no son
// tokens OAuth de corta duracion, asi que no hace falta refrescar nada.
const clientCache = new Map();

function createClientForConnection(connection) {
  let client = clientCache.get(connection.id);
  if (client) return client;

  const { accessKeyId, secretAccessKey, region } = connection.credentials;
  client = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
  clientCache.set(connection.id, client);
  return client;
}

export function invalidateCache(connectionId) {
  clientCache.delete(connectionId);
}

export async function getClientForUser(userId) {
  const connection = getActiveConnection(userId);
  if (!connection || connection.provider !== 's3') {
    const err = new Error('No tenes una conexion de S3 activa. Conectala primero en "Conectar almacenamiento".');
    err.httpStatus = 400;
    throw err;
  }
  return { client: createClientForConnection(connection), connection };
}

// Prueba que las credenciales/bucket ingresados en el formulario son
// validos antes de guardarlos, con una llamada minima (HeadBucket).
export async function testCredentials({ accessKeyId, secretAccessKey, bucket, region }) {
  const client = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (err) {
    throw toFriendlyError(err);
  }
}

// Traduce errores del SDK de AWS (nombre en err.name, status en
// err.$metadata.httpStatusCode) a mensajes entendibles y un httpStatus.
function toFriendlyError(err) {
  if (err && err.httpStatus) return err;

  const name = err?.name || '';
  const status = err?.$metadata?.httpStatusCode;

  let message = 'Ocurrio un error al comunicarse con S3.';
  let httpStatus = 502;

  if (name === 'InvalidAccessKeyId' || name === 'SignatureDoesNotMatch' || name === 'UnrecognizedClientException') {
    message = 'El Access Key o el Secret Key de S3 son invalidos.';
    httpStatus = 401;
  } else if (name === 'NoSuchBucket') {
    message = 'El bucket no existe (revisa el nombre y la region).';
    httpStatus = 404;
  } else if (name === 'NoSuchKey') {
    message = 'El archivo no existe.';
    httpStatus = 404;
  } else if (name === 'AccessDenied' || status === 403) {
    message = 'Las credenciales no tienen permiso para esa operacion en el bucket. Revisa la politica IAM.';
    httpStatus = 403;
  } else if (name === 'SlowDown' || status === 429) {
    message = 'Demasiadas solicitudes a S3. Espera un momento y volve a intentar.';
    httpStatus = 429;
  }

  const friendly = new Error(message);
  friendly.httpStatus = httpStatus;
  friendly.s3Detail = err?.message || String(err);
  return friendly;
}

async function withS3Client(userId, fn) {
  try {
    const { client, connection } = await getClientForUser(userId);
    return await fn(client, connection);
  } catch (err) {
    throw toFriendlyError(err);
  }
}

const MAX_ENTRIES = 2000;

// S3 no tiene carpetas reales: se simulan con "prefijos" de key que
// terminan en '/'. El "ref" que expone la API generica de fotoprint es,
// para S3, ese prefijo/key completo. La raiz es '' (prefijo vacio).
export async function listFolder(userId, parentRef) {
  return withS3Client(userId, async (client, connection) => {
    const prefix = parentRef; // ya viene con '/' final si no es raiz (ver createFolder/mapFolder)
    let entries = [];
    let continuationToken;

    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: connection.credentials.bucket,
          Prefix: prefix,
          Delimiter: '/',
          ContinuationToken: continuationToken,
        })
      );

      for (const commonPrefix of response.CommonPrefixes || []) {
        const fullPrefix = commonPrefix.Prefix;
        const name = fullPrefix.slice(prefix.length).replace(/\/$/, '');
        if (!name) continue;
        entries.push({ type: 'folder', name, ref: fullPrefix });
      }

      for (const object of response.Contents || []) {
        // El propio "marcador" de carpeta (objeto vacio con key == prefix) no se lista como archivo.
        if (object.Key === prefix) continue;
        const name = object.Key.slice(prefix.length);
        if (!name || name.includes('/')) continue;
        entries.push({
          type: 'file',
          name,
          ref: object.Key,
          size: object.Size,
          serverModified: object.LastModified ? new Date(object.LastModified).toISOString() : undefined,
        });
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken && entries.length < MAX_ENTRIES);

    return entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    });
  });
}

export async function createFolder(userId, parentRef, name) {
  return withS3Client(userId, async (client, connection) => {
    const ref = `${parentRef}${name}/`;
    // Objeto vacio a modo de "marcador" de carpeta (convencion clasica de S3;
    // asi la carpeta aparece aunque todavia no tenga archivos adentro).
    await client.send(
      new PutObjectCommand({ Bucket: connection.credentials.bucket, Key: ref, Body: new Uint8Array(0) })
    );
    return { type: 'folder', name, ref };
  });
}

// Sube el buffer tal cual llego del request, sin ningun procesamiento.
export async function uploadFile(userId, parentRef, name, buffer) {
  return withS3Client(userId, async (client, connection) => {
    const ref = `${parentRef}${name}`;
    await client.send(
      new PutObjectCommand({ Bucket: connection.credentials.bucket, Key: ref, Body: buffer })
    );
    // PutObject no devuelve el tamano guardado; lo confirmamos con un
    // HeadObject aparte para el chequeo de integridad en routes/files.js.
    const head = await client.send(new HeadObjectCommand({ Bucket: connection.credentials.bucket, Key: ref }));
    return { type: 'file', name, ref, size: head.ContentLength };
  });
}

export async function deleteFile(userId, ref) {
  return withS3Client(userId, async (client, connection) => {
    await client.send(new DeleteObjectCommand({ Bucket: connection.credentials.bucket, Key: ref }));
  });
}
