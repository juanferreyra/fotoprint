CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Una fila por conexion de nube que el usuario configuro (puede tener varias,
-- una por proveedor). is_active=1 marca cual es la que se usa ahora mismo.
CREATE TABLE IF NOT EXISTS cloud_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- La lista de proveedores validos se valida en la capa de aplicacion
  -- (routes/connections.js, routes/files.js), no con un CHECK aca, para no
  -- tener que migrar la tabla cada vez que se agrega un proveedor nuevo.
  provider TEXT NOT NULL,
  account_label TEXT,
  encrypted_credentials TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_cloud_connections_user ON cloud_connections(user_id);
