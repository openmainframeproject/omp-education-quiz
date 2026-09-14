/**
 * Database client and schema management for Mainframe Open Education
 * Supports PostgreSQL (production on Render / local) and SQLite/libSQL (development / testing).
 */

const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const { createClient } = require('@libsql/client');
const { config, resolvePgSsl } = require('./config');

const DATABASE_URL = config.databaseUrl;
const TURSO_URL = config.tursoDatabaseUrl;
const TURSO_TOKEN = config.tursoAuthToken;

// Determine if we should connect to PostgreSQL
const isPostgres = !!(
  DATABASE_URL &&
  (DATABASE_URL.startsWith('postgres://') || DATABASE_URL.startsWith('postgresql://'))
);

let pool = null;
let libsqlClient = null;
let pgPoolReady = null;

function createPgPool(sslValue) {
  const p = new Pool({
    connectionString: DATABASE_URL,
    ssl: sslValue,
    max: parseInt(process.env.PG_MAX_CONNECTIONS || '20', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  p.on('error', (err) => {
    console.error('[db:pg] Unexpected error on idle PostgreSQL client:', err.message);
  });
  return p;
}

/**
 * Lazily connects to PostgreSQL exactly once, resolving SSL up front:
 * 'auto' assumes SSL for remote hosts (managed cloud databases) and falls
 * back to plain connections if the server refuses SSL (sidecar / in-network).
 * Everything that needs the pool MUST go through this, so no consumer can
 * ever hold a stale pool reference.
 */
function ensurePgPool() {
  if (pgPoolReady) return pgPoolReady;
  pgPoolReady = (async () => {
    const pgSsl = resolvePgSsl(DATABASE_URL);
    let hostname = '';
    try { hostname = new URL(DATABASE_URL).hostname; } catch (e) {}
    const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);

    let candidateSsl =
      pgSsl === 'auto'
        ? isLoopback ? false : { rejectUnauthorized: false }
        : pgSsl;

    let candidate = createPgPool(candidateSsl);
    try {
      await candidate.query('SELECT 1');
    } catch (err) {
      if (candidateSsl && /ssl/i.test(String(err && err.message))) {
        console.warn(`[db:pg] Server refused SSL (${String(err.message).trim()}); reconnecting without SSL...`);
        const refused = candidate;
        candidate = createPgPool(false);
        refused.end().catch(() => {});
        await candidate.query('SELECT 1');
      } else {
        throw err;
      }
    }
    pool = candidate;
    return pool;
  })();
  return pgPoolReady;
}

if (!isPostgres) {
  const localDbUrl = TURSO_URL || 'file:' + path.join(__dirname, 'data', 'moe.db');
  if (localDbUrl.startsWith('file:')) {
    fs.mkdirSync(path.dirname(localDbUrl.replace(/^file:/, '')), { recursive: true });
  }
  libsqlClient = createClient({
    url: localDbUrl,
    authToken: TURSO_TOKEN || undefined,
  });
}

/**
 * Normalizes SQL queries and parameter placeholders between PostgreSQL ($1, $2) and SQLite (?)
 */
function normalizeQuery(sql, args = []) {
  let text = sql;
  let params = Array.isArray(args) ? [...args] : [];

  if (isPostgres) {
    // If query was written with SQLite `?` placeholders, convert to `$1, $2, ...`
    if (text.includes('?') && !text.includes('$1')) {
      let paramIdx = 1;
      text = text.replace(/\?/g, () => `$${paramIdx++}`);
    }
  } else {
    // If query was written with Postgres `$1, $2` placeholders, convert to `?`
    if (/\$\d+/.test(text) && !text.includes('?')) {
      text = text.replace(/\$\d+/g, '?');
    }
  }

  return { text, params };
}

/**
 * Execute a query against the active database backend
 * @param {string|object} queryOrConfig - SQL string or object with { sql, args }
 * @param {Array} [params] - Positional parameters
 * @returns {Promise<{ rows: Array, rowCount?: number }>}
 */
async function query(queryOrConfig, params = []) {
  let sql = typeof queryOrConfig === 'string' ? queryOrConfig : queryOrConfig.sql;
  let args = typeof queryOrConfig === 'object' && queryOrConfig.args ? queryOrConfig.args : params;

  const { text, params: cleanArgs } = normalizeQuery(sql, args);

  if (isPostgres) {
    const activePool = await ensurePgPool();
    const res = await activePool.query(text, cleanArgs);
    return {
      rows: res.rows,
      rowCount: res.rowCount,
    };
  } else {
    const res = await libsqlClient.execute({
      sql: text,
      args: cleanArgs,
    });
    return {
      rows: res.rows || [],
      rowCount: res.rowsAffected || (res.rows ? res.rows.length : 0),
    };
  }
}

/**
 * Resolves once the active PostgreSQL pool is connected (no-op for SQLite).
 * Returns the live pool — always call this instead of holding a reference,
 * so SSL fallback can swap pools safely.
 */
async function getPool() {
  if (isPostgres) return ensurePgPool();
  return null;
}

/**
 * Initialize all application database schemas
 */
async function initSchema() {
  if (isPostgres) {
    await ensurePgPool();
    console.log('[db] Initializing PostgreSQL schema on Render/Cloud...');

    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure columns exist for older installations
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;`);

    // Progress tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS progress (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        page_url TEXT NOT NULL,
        completed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, page_url)
      );
    `);

    // Issued badges log
    await pool.query(`
      CREATE TABLE IF NOT EXISTS badges (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credly_badge_id TEXT,
        badge_template_id TEXT NOT NULL,
        issued_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, badge_template_id)
      );
    `);

    // Official certification badge claims
    await pool.query(`
      CREATE TABLE IF NOT EXISTS badge_claims (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL,
        exam_score INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        claimed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Optional express-session PostgreSQL table (created if connect-pg-simple is used)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      ) WITH (OIDS=FALSE);
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);

    console.log('[db] PostgreSQL tables and indexes ready.');
  } else {
    console.log('[db] Initializing local SQLite/libSQL schema...');
    await libsqlClient.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    try { await libsqlClient.execute(`ALTER TABLE users ADD COLUMN first_name TEXT`); } catch (e) {}
    try { await libsqlClient.execute(`ALTER TABLE users ADD COLUMN last_name TEXT`); } catch (e) {}

    await libsqlClient.execute(`
      CREATE TABLE IF NOT EXISTS progress (
        user_id INTEGER NOT NULL,
        page_url TEXT NOT NULL,
        completed_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, page_url)
      )
    `);
    await libsqlClient.execute(`
      CREATE TABLE IF NOT EXISTS badges (
        user_id INTEGER NOT NULL,
        credly_badge_id TEXT,
        badge_template_id TEXT NOT NULL,
        issued_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, badge_template_id)
      )
    `);
    await libsqlClient.execute(`
      CREATE TABLE IF NOT EXISTS badge_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL,
        exam_score INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        claimed_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id)
      )
    `);
    console.log('[db] SQLite/libSQL schema initialized.');
  }
}

/**
 * Close the active database backend (used by graceful shutdown).
 */
async function close() {
  if (isPostgres && pool) {
    await pool.end();
  } else if (libsqlClient) {
    libsqlClient.close();
  }
}

module.exports = {
  isPostgres,
  pool,
  getPool,
  libsqlClient,
  query,
  execute: query,
  initSchema,
  close,
};