import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { db } from '../db.js';

const SALT_ROUNDS = 12;

const insertUserStmt = db.prepare(
  'INSERT INTO users (email, password_hash) VALUES (@email, @password_hash)'
);
const findByEmailStmt = db.prepare('SELECT * FROM users WHERE email = ?');
const findByIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');
const listAllStmt = db.prepare('SELECT * FROM users ORDER BY created_at');
const setAdminStmt = db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?');
const setPasswordHashStmt = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const deleteUserStmt = db.prepare('DELETE FROM users WHERE id = ?');

export async function createUser(email, password) {
  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
  const info = insertUserStmt.run({ email, password_hash });
  return findByIdStmt.get(info.lastInsertRowid);
}

export function findUserByEmail(email) {
  return findByEmailStmt.get(email);
}

export function findUserById(id) {
  return findByIdStmt.get(id);
}

export function listAllUsers() {
  return listAllStmt.all();
}

export function promoteToAdmin(userId) {
  setAdminStmt.run(userId);
}

export async function verifyPassword(user, password) {
  return bcrypt.compare(password, user.password_hash);
}

// Genera una contrasena temporal al azar y la guarda ya hasheada. Se
// devuelve en texto plano una sola vez, para que el admin se la pase al
// usuario (la app no manda emails).
export async function resetPassword(userId) {
  const tempPassword = crypto.randomBytes(9).toString('base64url');
  const password_hash = await bcrypt.hash(tempPassword, SALT_ROUNDS);
  setPasswordHashStmt.run(password_hash, userId);
  return tempPassword;
}

// Borra la cuenta. cloud_connections tiene ON DELETE CASCADE (user_id), asi
// que sus conexiones de nube se borran solas; el llamador (routes/admin.js)
// se encarga de borrar la carpeta local en disco, ya que eso vive fuera de
// la base de datos.
export function deleteUser(userId) {
  deleteUserStmt.run(userId);
}

export function toPublicUser(user) {
  return { id: user.id, email: user.email, is_admin: Boolean(user.is_admin), created_at: user.created_at };
}
