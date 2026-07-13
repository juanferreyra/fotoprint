import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { getActiveConnection } from './connections.js';
import { findUserById } from './users.js';

export const ACCOUNT_LABEL = 'Carpeta del proyecto (media/)';

// A diferencia de los demas proveedores, "local" no tiene credenciales: los
// archivos se guardan directamente en disco, en config.mediaDir. Cada
// usuario tiene su propia subcarpeta con el nombre de su email (saneado)
// para que sea facil identificar de quien es cada carpeta mirando el
// filesystem, y para que el admin (ver mas abajo) pueda reconocerlas.
function sanitizeFolderName(email) {
  return email.replace(/[^a-zA-Z0-9._@-]/g, '_');
}

// Migracion de instalaciones viejas: antes las carpetas se llamaban
// user-<id> en vez del email. Si existe la carpeta vieja y todavia no se
// migro, se renombra sola la primera vez que el usuario vuelve a usar el
// proveedor local.
async function migrateLegacyFolder(userId, folderName) {
  const legacyDir = path.join(config.mediaDir, `user-${userId}`);
  const newDir = path.join(config.mediaDir, folderName);
  if (legacyDir === newDir) return;

  try {
    await fs.access(newDir);
    return; // ya existe la carpeta nueva, no hay nada que migrar
  } catch {
    // sigue si newDir no existe todavia
  }

  try {
    await fs.rename(legacyDir, newDir);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // ENOENT: no habia carpeta vieja, no hay nada que migrar
  }
}

// El admin ve config.mediaDir directamente como raiz (una carpeta por
// usuario, todas visibles), mientras que un usuario comun solo ve su
// propia subcarpeta como raiz, sin poder salir de ahi.
async function resolveContext(userId) {
  const user = findUserById(userId);
  if (!user) {
    const err = new Error('Usuario no encontrado.');
    err.httpStatus = 401;
    throw err;
  }

  const folderName = sanitizeFolderName(user.email);
  await migrateLegacyFolder(userId, folderName);

  const root = user.is_admin ? config.mediaDir : path.join(config.mediaDir, folderName);
  return { isAdmin: Boolean(user.is_admin), root };
}

// Traduce un ref opaco (path relativo tipo '/Vacaciones/foto.jpg', igual
// que Dropbox/FTP) a una ruta absoluta en disco, verificando que quede
// adentro de la raiz correspondiente. routes/files.js ya rechaza '..' en
// el ref antes de llegar aca, pero esto es una segunda barrera por si
// local.js se llega a usar desde otro lado.
function resolveWithinRoot(root, ref) {
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
  const { root } = await resolveContext(userId);
  const dir = resolveWithinRoot(root, parentRef);
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
  const { root } = await resolveContext(userId);
  const ref = joinRef(parentRef, name);
  const dir = resolveWithinRoot(root, ref);

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
  const { root } = await resolveContext(userId);
  const ref = joinRef(parentRef, name);
  const filePath = resolveWithinRoot(root, ref);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
  const stat = await fs.stat(filePath);
  return { type: 'file', name, ref, size: stat.size };
}

export async function deleteFile(userId, ref) {
  ensureActive(userId);
  const { root } = await resolveContext(userId);
  const filePath = resolveWithinRoot(root, ref);
  await fs.unlink(filePath);
}

export async function downloadFile(userId, ref) {
  ensureActive(userId);
  const { root } = await resolveContext(userId);
  const filePath = resolveWithinRoot(root, ref);
  return fs.readFile(filePath);
}

// No hay ningun cliente/token cacheado para el proveedor local (no hay
// conexion con estado, solo el filesystem), asi que no hay nada que
// invalidar. Se exporta igual para que routes/connections.js pueda tratar
// a los cinco proveedores de forma uniforme.
export function invalidateCache() {}
