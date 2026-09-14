/**
 * Platform-agnostic runtime configuration.
 *
 * This is the ONLY module allowed to read process.env. Every other module
 * imports from here, which is what makes MOE portable across hosting
 * platforms (Render, DigitalOcean, Railway, Fly.io, Kubernetes, bare Docker).
 *
 * Canonical environment contract (full table in docs/deploy/README.md):
 *   PORT                  HTTP port                          (default 3000)
 *   NODE_ENV              "production" enables hardened defaults
 *   TRUST_PROXY           Express `trust proxy` value        (default: 1 hop in production, off otherwise)
 *   DATABASE_URL          PostgreSQL connection string       (alias: POSTGRES_URL; unset = SQLite/Turso)
 *   TURSO_DATABASE_URL    Remote libSQL URL                  (optional)
 *   TURSO_AUTH_TOKEN      Remote libSQL auth token           (optional)
 *   SESSION_SECRET        Session cookie signing secret      (REQUIRED in production)
 *   ADMIN_SECRET          Admin API secret                   (falls back to SESSION_SECRET)
 *   SANDBOX_URL           External COBOL sandbox endpoint    (default: public sandbox instance)
 *   SITEMAP_REFRESH_MS    GitBook sitemap refresh interval   (default 3600000)
 *   FETCH_TIMEOUT_MS      Outbound fetch timeout             (default 15000)
 *   CREDLY_*              Badge issuance credentials         (optional; mock mode when unset)
 */

const INSECURE_DEFAULT_SECRET = 'moe-dev-insecure-secret-change-me';

const isProduction = (process.env.NODE_ENV || '') === 'production';

function parseTrustProxy(raw, production) {
  if (raw === undefined || raw === null || raw === '') return production ? 1 : false;
  const value = String(raw).trim();
  if (/^(true|yes|on)$/i.test(value)) return true;
  if (/^(false|no|off)$/i.test(value)) return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

function parsePositiveInt(raw, fallback) {
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction,
  port: parsePositiveInt(process.env.PORT, 3000),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY, isProduction),

  databaseUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL || '',
  tursoDatabaseUrl: process.env.TURSO_DATABASE_URL || '',
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN || '',

  sessionSecret: process.env.SESSION_SECRET || INSECURE_DEFAULT_SECRET,
  adminSecret: process.env.ADMIN_SECRET || process.env.SESSION_SECRET || INSECURE_DEFAULT_SECRET,

  sandboxUrl: process.env.SANDBOX_URL || 'https://mainframe-sandbox.onrender.com',

  gitbookBase: 'https://open-mainframe-project.gitbook.io',
  llmsTxtPath: '/mainframe-open-education-project/llms.txt',

  sitemapRefreshMs: parsePositiveInt(process.env.SITEMAP_REFRESH_MS, 60 * 60 * 1000),
  fetchTimeoutMs: parsePositiveInt(process.env.FETCH_TIMEOUT_MS, 15000),

  credly: {
    apiBase: process.env.CREDLY_API_BASE || 'https://api.credly.com/v1',
    orgId: process.env.CREDLY_ORG_ID || '',
    authToken: process.env.CREDLY_AUTH_TOKEN || '',
    badgeTemplateId: process.env.CREDLY_BADGE_TEMPLATE_ID || 'moe-practitioner-badge',
  },

  pgSslMode: (process.env.PGSSLMODE || '').trim().toLowerCase(),
};

/**
 * Resolves the `pg` SSL setting for a PostgreSQL connection string.
 *
 * Precedence: `?sslmode=` in the URL, then PGSSLMODE env, then auto-detect.
 *   disable            → SSL off (in-network/sidecar databases)
 *   require|verify-*   → SSL enforced (most managed cloud databases)
 *   auto (default)     → caller should connect with SSL for remote hosts and
 *                        transparently retry without it if the server refuses
 *
 * @returns {false|{rejectUnauthorized:boolean}|'auto'}
 */
function resolvePgSsl(databaseUrl) {
  const urlMode = (/([?&])sslmode=([^&]+)/.exec(databaseUrl || '') || [])[2];
  const mode = (urlMode || '').toLowerCase() || config.pgSslMode;
  if (mode === 'disable') return false;
  if (mode === 'require' || mode === 'verify-ca' || mode === 'verify-full') {
    return { rejectUnauthorized: mode === 'verify-full' };
  }
  return 'auto';
}

/**
 * Returns a list of configuration problems that MUST abort startup in
 * production. Safe to call in development, where it is advisory only.
 * Derived exclusively from the loaded `config` snapshot, never live env.
 */
function productionConfigProblems() {
  if (!config.isProduction) return [];
  const problems = [];
  if (config.sessionSecret === INSECURE_DEFAULT_SECRET) {
    problems.push('SESSION_SECRET is missing or still set to the insecure dev default.');
  }
  if (config.adminSecret === INSECURE_DEFAULT_SECRET || config.adminSecret === config.sessionSecret) {
    problems.push('ADMIN_SECRET is missing or falls back to SESSION_SECRET instead of being independent.');
  }
  return problems;
}

module.exports = { config, productionConfigProblems, resolvePgSsl, INSECURE_DEFAULT_SECRET };
