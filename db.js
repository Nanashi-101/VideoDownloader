require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      role       TEXT NOT NULL DEFAULT 'user',
      is_active  BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS downloads (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      url          TEXT NOT NULL,
      title        TEXT,
      filename     TEXT,
      format       TEXT,
      size_bytes   BIGINT,
      status       TEXT NOT NULL DEFAULT 'pending',
      error        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_downloads_user   ON downloads(user_id)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status)`);
  console.log('  PostgreSQL tables ready');
}

module.exports = { query, initDB, pool };
