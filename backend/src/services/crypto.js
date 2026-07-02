import crypto from 'node:crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey() {
  const key = Buffer.from(config.tokenEncryptionKey, 'hex');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY debe ser una clave hex de 32 bytes (64 caracteres hex).');
  }
  return key;
}

// Cifra un objeto JS (por ej. tokens OAuth o credenciales S3) antes de guardarlo en la DB.
export function encryptJson(value) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decryptJson(payload) {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = raw.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}
