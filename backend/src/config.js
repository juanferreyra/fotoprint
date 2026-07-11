import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}. Revisa backend/.env (copia .env.example).`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  databaseFile: path.resolve(backendRoot, process.env.DATABASE_FILE || './data/fotoprint.sqlite'),
  // Carpeta usada por el proveedor "local" (services/local.js). Por
  // defecto es media/ en la raiz del proyecto (un nivel arriba de backend/),
  // no dentro de backend/, para que quede claro que es contenido del
  // usuario y no parte del codigo del servidor.
  mediaDir: path.resolve(backendRoot, process.env.MEDIA_DIR || '../media'),
  sessionSecret: required('SESSION_SECRET'),
  tokenEncryptionKey: required('TOKEN_ENCRYPTION_KEY'),
  dropbox: {
    appKey: process.env.DROPBOX_APP_KEY || '',
    appSecret: process.env.DROPBOX_APP_SECRET || '',
    get redirectUri() {
      return `${config.baseUrl}/api/connections/dropbox/callback`;
    },
  },
  googleDrive: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    get redirectUri() {
      return `${config.baseUrl}/api/connections/google_drive/callback`;
    },
  },
};
