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
db.exec(fs.readFileSync(schemaPath, 'utf8'));
