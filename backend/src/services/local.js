import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { getActiveConnection } from './connections.js';

// A diferencia de los demas proveedores, "local" no tiene credenciales: los
// archivos se guardan directamente en disco, en config.mediaDir. Cada
// usuario tiene su propia subcarpeta (user-<id>) para que dos usuarios que
// usen "local" en el mismo despliegue no compartan ni pisen archivos.
function userRoot(userId) {
  return path.join(config.mediaDir, `user-${userId}`);
}

// Traduce un ref opaco (path relativo tipo '/Vacaciones/foto.jpg', igual
// que Dropbox/FTP) a una ruta absoluta en disco, verificando que quede
// adentro de la carpeta del usuario. routes/files.js ya rechaza '..' en el
// ref antes de llegar aca, pero esto es una segunda barrera por si
// local.js se llega a usar desde otro lado.
function resolvePath(userId, ref) {
  const root = userRoot(userId);
  const relative = ref === '' ? '' : ref.replace(/^\/+/, '');
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    const err = new Error('Referencia de carpeta invalida.');
    err.httpStatus = 400;
    throw err;
  }
  return resolved;
}

function joinRef(parentRef, name) {
  const base = parentRef === '' ? '' : parentRef;
  return `${base}/${name}`.replace(/\/+/g, '/');
}

function ensureActive(userId) {
  const connection = getActiveConnection(userId);
  if (!connection || connection.provider !== 'local') {
    const err = new Error('No tenes la carpeta local activa. Conectala primero en "Conectar almacenamiento".');
    err.httpStatus = 400;
    throw err;
  }
}

// No hay credenciales que probar: solo confirmamos que se puede crear la
// carpeta base en disco (permisos del filesystem).
export async function testCredentials() {
  await fs.mkdir(config.mediaDir, { recursive: true });
}

export async function listFolder(userId, parentRef) {
  ensureActive(userId);
  const dir = resolvePath(userId, parentRef);
  await fs.mkdir(dir, { recursive: true });
  const items = await fs.readdir(dir, { withFileTypes: true });

  const entries = await Promise.all(
    items.map(async (item) => {
      const ref = joinRef(parentRef, item.name);
      if (item.isDirectory()) {
        return { type: 'folder', name: item.name, ref };
      }
      const stat = await fs.stat(path.join(dir, item.name));
      return {
        type: 'file',
        name: item.name,
        ref,
        size: stat.size,
        serverModified: stat.mtime.toISOString(),
      };
    })
  );

  return entries
    .filter(Boolean)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
    });
}

export async function createFolder(userId, parentRef, name) {
  ensureActive(userId);
  const ref = joinRef(parentRef, name);
  const dir = resolvePath(userId, ref);

  try {
    await fs.access(dir);
    const err = new Error('Ya existe una carpeta con ese nombre.');
    err.httpStatus = 409;
    throw err;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  await fs.mkdir(dir, { recursive: true });
  return { type: 'folder', name, ref };
}

// Guarda el buffer tal cual llego del request, sin ningun procesamiento.
export async function uploadFile(userId, parentRef, name, buffer) {
  ensureActive(userId);
  const ref = joinRef(parentRef, name);
  const filePath = resolvePath(userId, ref);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
  const stat = await fs.stat(filePath);
  return { type: 'file', name, ref, size: stat.size };
}

export async function deleteFile(userId, ref) {
  ensureActive(userId);
  const filePath = resolvePath(userId, ref);
  await fs.unlink(filePath);
}

// No hay ningun cliente/token cacheado para el proveedor local (no hay
// conexion con estado, solo el filesystem), asi que no hay nada que
// invalidar. Se exporta igual para que routes/connections.js pueda tratar
// a los cinco proveedores de forma uniforme.
export function invalidateCache() {}
