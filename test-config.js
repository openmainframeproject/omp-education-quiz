/**
 * Test Suite for Platform-Agnostic Configuration Layer (config.js)
 */

const path = require('path');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    throw new Error(message);
  }
  passedTests++;
  console.log(`  ✓ PASSED: ${message}`);
}

function loadConfig(env) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  delete require.cache[require.resolve('./config')];
  const mod = require('./config');
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return mod;
}

async function runTestSuite() {
  console.log('\n============================================================');
  console.log('🧪 RUNNING CONFIG ABSTRACTION LAYER TEST SUITE');
  console.log('============================================================\n');

  console.log('--- TEST GROUP 1: Defaults & Port Parsing ---');

  let { config } = loadConfig({ PORT: undefined, NODE_ENV: undefined });

  assert(config.port === 3000, 'PORT falls back to 3000 when unset');
  assert(config.isProduction === false, 'NODE_ENV unset means development mode');
  assert(config.env === 'development', 'config.env reports development');
  assert(config.trustProxy === false, 'trust proxy disabled by default in development');
  assert(typeof config.sessionSecret === 'string' && config.sessionSecret.length > 0, 'session secret always has a value (dev default)');
  assert(config.sitemapRefreshMs === 3600000, 'sitemap refresh interval defaults to 1 hour');
  assert(config.fetchTimeoutMs === 15000, 'fetch timeout defaults to 15 seconds');
  assert(config.gitbookBase.startsWith('https://'), 'GitBook base URL is configured');

  ({ config } = loadConfig({ PORT: '8080' }));
  assert(config.port === 8080, 'PORT=8080 is honored');

  ({ config } = loadConfig({ PORT: 'not-a-number' }));
  assert(config.port === 3000, 'Non-numeric PORT falls back to 3000');

  console.log('\n--- TEST GROUP 2: TRUST_PROXY Parsing (multi-platform proxies) ---');

  ({ config } = loadConfig({ NODE_ENV: 'production', TRUST_PROXY: undefined }));
  assert(config.trustProxy === 1, 'Production defaults to 1 proxy hop (legacy Render-compatible behavior)');
  assert(config.isProduction === true, 'NODE_ENV=production is detected');

  ({ config } = loadConfig({ NODE_ENV: 'production', TRUST_PROXY: 'true' }));
  assert(config.trustProxy === true, 'TRUST_PROXY=true maps to boolean true (all hops trusted)');

  ({ config } = loadConfig({ NODE_ENV: 'production', TRUST_PROXY: 'false' }));
  assert(config.trustProxy === false, 'TRUST_PROXY=false disables proxy trust');

  ({ config } = loadConfig({ NODE_ENV: 'production', TRUST_PROXY: '3' }));
  assert(config.trustProxy === 3, 'TRUST_PROXY=3 trusts three proxy hops');

  ({ config } = loadConfig({ NODE_ENV: 'production', TRUST_PROXY: '10.0.0.1, 10.0.0.2' }));
  assert(Array.isArray(config.trustProxy) && config.trustProxy.length === 2, 'TRUST_PROXY accepts comma-separated proxy IPs');

  console.log('\n--- TEST GROUP 3: Database URL Resolution & Aliases ---');

  ({ config } = loadConfig({ DATABASE_URL: undefined, POSTGRES_URL: undefined }));
  assert(config.databaseUrl === '', 'No DATABASE_URL means SQLite/libSQL mode downstream');

  ({ config } = loadConfig({ DATABASE_URL: 'postgres://u:p@host/db', POSTGRES_URL: undefined }));
  assert(config.databaseUrl === 'postgres://u:p@host/db', 'DATABASE_URL is read directly');

  const aliased = loadConfig({ DATABASE_URL: undefined, POSTGRES_URL: 'postgresql://u:p@legacy/db' });
  assert(aliased.config.databaseUrl === 'postgresql://u:p@legacy/db', 'Legacy POSTGRES_URL alias is honored when DATABASE_URL unset');

  console.log('\n--- TEST GROUP 4: Credly Configuration ---');

  ({ config } = loadConfig({}));
  assert(config.credly.apiBase === 'https://api.credly.com/v1', 'Credly API base defaults to production endpoint');
  assert(config.credly.orgId === '', 'Missing CREDLY_ORG_ID yields empty string (mock badge mode)');
  assert(config.credly.authToken === '', 'Missing CREDLY_AUTH_TOKEN yields empty string');
  assert(config.credly.badgeTemplateId === 'moe-practitioner-badge', 'Badge template ID has MOE default');

  ({ config } = loadConfig({ CREDLY_BADGE_TEMPLATE_ID: 'custom-template' }));
  assert(config.credly.badgeTemplateId === 'custom-template', 'CREDLY_BADGE_TEMPLATE_ID override works');

  console.log('\n--- TEST GROUP 5: Production Secret Validation (fail fast) ---');

  let problems = loadConfig({ NODE_ENV: undefined }).productionConfigProblems();
  assert(Array.isArray(problems) && problems.length === 0, 'Development mode never blocks startup');

  problems = loadConfig({ NODE_ENV: 'production', SESSION_SECRET: undefined, ADMIN_SECRET: undefined }).productionConfigProblems();
  assert(problems.length >= 1 && problems.some(p => p.includes('SESSION_SECRET')), 'Production without SESSION_SECRET produces a blocking problem');
  assert(problems.some(p => p.includes('ADMIN_SECRET')), 'Production without ADMIN_SECRET produces a warning problem');
  problems = loadConfig({
    NODE_ENV: 'production',
    SESSION_SECRET: 'moe-dev-insecure-secret-change-me',
    ADMIN_SECRET: undefined,
  }).productionConfigProblems();
  assert(problems.some(p => p.toLowerCase().includes('insecure dev default')), 'Insecure default SESSION_SECRET is rejected in production');

  problems = loadConfig({
    NODE_ENV: 'production',
    SESSION_SECRET: 'a-strong-random-secret',
    ADMIN_SECRET: 'another-strong-secret',
  }).productionConfigProblems();
  assert(problems.length === 0, 'Fully configured production environment passes validation cleanly');

  console.log('\n--- TEST GROUP 6: Sandbox & Sitemap Tunables ---');

  ({ config } = loadConfig({ SANDBOX_URL: undefined }));
  assert(config.sandboxUrl.startsWith('https://'), 'COBOL sandbox URL has an HTTPS default');

  ({ config } = loadConfig({ SITEMAP_REFRESH_MS: '5000' }));
  assert(config.sitemapRefreshMs === 5000, 'SITEMAP_REFRESH_MS override is honored');

  ({ config } = loadConfig({ FETCH_TIMEOUT_MS: '30000' }));
  assert(config.fetchTimeoutMs === 30000, 'FETCH_TIMEOUT_MS override is honored');

  console.log('\n--- TEST GROUP 7: PostgreSQL SSL Resolution (multi-platform DBs) ---');

  const { resolvePgSsl } = require('./config');

  assert(resolvePgSsl('postgres://u:p@db:5432/moe?sslmode=disable') === false, 'URL sslmode=disable forces SSL off');
  let r = loadConfig({ PGSSLMODE: 'disable' });
  assert(r.resolvePgSsl('postgres://u:p@db:5432/moe') === false, 'PGSSLMODE=disable forces SSL off');
  r = loadConfig({ PGSSLMODE: 'require' });
  assert(r.resolvePgSsl('postgres://u:p@cloud/db').rejectUnauthorized === false, 'PGSSLMODE=require enables SSL without CA verification');
  r = loadConfig({ PGSSLMODE: 'verify-full' });
  assert(r.resolvePgSsl('postgres://u:p@cloud/db').rejectUnauthorized === true, 'PGSSLMODE=verify-full enables CA verification');
  assert(resolvePgSsl('postgres://u:p@cloud/db?sslmode=disable') === false, 'URL sslmode overrides PGSSLMODE');
  assert(resolvePgSsl('postgres://u:p@managed-cloud-host/db') === 'auto', 'Managed cloud host with no mode resolves to auto-detect');

  console.log('\n--- TEST GROUP 8: Module Contract ---');

  const modPath = require.resolve('./config');
  assert(path.basename(modPath) === 'config.js', 'config.js lives at repository root');
  const mod = require('./config');
  assert(typeof mod.productionConfigProblems === 'function', 'exports productionConfigProblems()');

  console.log('\n============================================================');
  console.log(`🎉 ALL ${passedTests} OF ${totalTests} TESTS PASSED SUCCESSFULLY!`);
  console.log('============================================================\n');
}

runTestSuite().catch((err) => {
  console.error('\n❌ Test suite failed with error:', err);
  process.exitCode = 1;
});
