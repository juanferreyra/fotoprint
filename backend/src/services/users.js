import bcrypt from 'bcrypt';
import { db } from '../db.js';

const SALT_ROUNDS = 12;

const insertUserStmt = db.prepare(
  'INSERT INTO users (email, password_hash) VALUES (@email, @password_hash)'
);
const findByEmailStmt = db.prepare('SELECT * FROM users WHERE email = ?');
const findByIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');

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

export async function verifyPassword(user, password) {
  return bcrypt.compare(password, user.password_hash);
}

export function toPublicUser(user) {
  return { id: user.id, email: user.email, created_at: user.created_at };
}
