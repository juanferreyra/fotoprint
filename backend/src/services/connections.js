import { db } from '../db.js';
import { encryptJson, decryptJson } from './crypto.js';

const upsertStmt = db.prepare(`
  INSERT INTO cloud_connections (user_id, provider, account_label, encrypted_credentials, is_active, updated_at)
  VALUES (@user_id, @provider, @account_label, @encrypted_credentials, 1, datetime('now'))
  ON CONFLICT(user_id, provider) DO UPDATE SET
    account_label = excluded.account_label,
    encrypted_credentials = excluded.encrypted_credentials,
    is_active = 1,
    updated_at = datetime('now')
`);

const deactivateOthersStmt = db.prepare(
  'UPDATE cloud_connections SET is_active = 0 WHERE user_id = ? AND provider != ?'
);

const listStmt = db.prepare(
  'SELECT id, provider, account_label, is_active, created_at, updated_at FROM cloud_connections WHERE user_id = ? ORDER BY provider'
);

const findActiveStmt = db.prepare(
  'SELECT * FROM cloud_connections WHERE user_id = ? AND is_active = 1 LIMIT 1'
);

const findByProviderStmt = db.prepare(
  'SELECT * FROM cloud_connections WHERE user_id = ? AND provider = ?'
);

const activateStmt = db.prepare(
  'UPDATE cloud_connections SET is_active = 1, updated_at = datetime(\'now\') WHERE user_id = ? AND provider = ?'
);

const deleteStmt = db.prepare('DELETE FROM cloud_connections WHERE user_id = ? AND provider = ?');

const saveTx = db.transaction((userId, provider, accountLabel, credentials) => {
  upsertStmt.run({
    user_id: userId,
    provider,
    account_label: accountLabel,
    encrypted_credentials: encryptJson(credentials),
  });
  deactivateOthersStmt.run(userId, provider);
});

export function saveConnection(userId, provider, accountLabel, credentials) {
  saveTx(userId, provider, accountLabel, credentials);
}

export function listConnections(userId) {
  return listStmt.all(userId);
}

export function getActiveConnection(userId) {
  const row = findActiveStmt.get(userId);
  if (!row) return null;
  return { ...row, credentials: decryptJson(row.encrypted_credentials) };
}

export function getConnection(userId, provider) {
  const row = findByProviderStmt.get(userId, provider);
  if (!row) return null;
  return { ...row, credentials: decryptJson(row.encrypted_credentials) };
}

export function updateConnectionCredentials(userId, provider, credentials) {
  const row = findByProviderStmt.get(userId, provider);
  if (!row) return;
  db.prepare(
    "UPDATE cloud_connections SET encrypted_credentials = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(encryptJson(credentials), row.id);
}

const activateTx = db.transaction((userId, provider) => {
  deactivateOthersStmt.run(userId, provider);
  activateStmt.run(userId, provider);
});

export function activateConnection(userId, provider) {
  const row = findByProviderStmt.get(userId, provider);
  if (!row) return false;
  activateTx(userId, provider);
  return true;
}

export function deleteConnection(userId, provider) {
  const info = deleteStmt.run(userId, provider);
  return info.changes > 0;
}
