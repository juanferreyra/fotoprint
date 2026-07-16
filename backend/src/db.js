import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });

export const db = new Database(config.databaseFile);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaPath = path.resolve(fileURLToPath(import.meta.url), '..', 'db', 'schema.sql');
const schemaSql = fs.readFileSync(schemaPath, 'utf8');
db.exec(schemaSql);

// Migracion para bases creadas antes de quitar el CHECK(provider IN (...))
// de cloud_connections (SQLite no soporta ALTER de un CHECK existente, hay
// que recrear la tabla).
function migrateDropProviderCheckConstraint() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cloud_connections'").get();
  if (!row || !row.sql.includes('CHECK')) return;

  db.transaction(() => {
    db.exec('ALTER TABLE cloud_connections RENAME TO cloud_connections_old');
    db.exec(schemaSql);
    db.exec(`
      INSERT INTO cloud_connections (id, user_id, provider, account_label, encrypted_credentials, is_active, created_at, updated_at)
      SELECT id, user_id, provider, account_label, encrypted_credentials, is_active, created_at, updated_at
      FROM cloud_connections_old
    `);
    db.exec('DROP TABLE cloud_connections_old');
  })();
}

migrateDropProviderCheckConstraint();

// Migracion para bases creadas antes de agregar la columna is_admin.
function migrateAddIsAdminColumn() {
  const columns = db.prepare("PRAGMA table_info(users)").all();
  const hasIsAdmin = columns.some((col) => col.name === 'is_admin');
  if (hasIsAdmin) return;

  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
}

migrateAddIsAdminColumn();
