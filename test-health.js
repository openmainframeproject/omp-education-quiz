/**
 * Test Suite for Platform-Neutral Health Endpoints & Graceful Shutdown
 * Boots the real server.js as a child process, like a hosting platform would.
 */

const { spawn } = require('child_process');

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

const TEST_PORT = 3977;

async function waitUntilHealthy(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early with code ${child.exitCode}: ${String(child.stderrData || '')}`);
    try {
      const res = await fetch(`http://127.0.0.1:${TEST_PORT}/healthz`);
      if (res.ok) return await res.json();
    } catch (err) {
      lastErr = err;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Server did not become healthy in ${timeoutMs}ms (${lastErr ? lastErr.message : 'unknown'})`);
}

function startServer(env) {
  const childEnv = { ...process.env, PORT: String(TEST_PORT) };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  const child = spawn(process.execPath, ['server.js'], {
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdoutData = '';
  child.stderrData = '';
  child.stdout.on('data', d => { child.stdoutData += d; });
  child.stderr.on('data', d => { child.stderrData += d; });
  return child;
}

async function waitForExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && child.exitCode === null) {
    await new Promise(r => setTimeout(r, 200));
  }
  return child.exitCode;
}

async function runTestSuite() {
  console.log('\n============================================================');
  console.log('🧪 RUNNING HEALTH ENDPOINT & GRACEFUL SHUTDOWN TEST SUITE');
  console.log('============================================================\n');

  console.log('--- TEST GROUP 1: Liveness & Readiness Endpoints ---');

  let child = startServer({ NODE_ENV: 'development' });
  const health = await waitUntilHealthy(child, 30000);
  assert(health.ok === true, 'GET /healthz reports ok: true');
  assert(typeof health.uptimeSeconds === 'number', 'GET /healthz exposes uptimeSeconds');
  assert(health.env === 'development', 'GET /healthz reports the runtime environment');

  const readyRes = await fetch(`http://127.0.0.1:${TEST_PORT}/readyz`);
  assert(readyRes.status === 200, 'GET /readyz returns HTTP 200 when dependencies are reachable');
  const ready = await readyRes.json();
  assert(ready.ok === true, 'GET /readyz reports ok: true');
  assert(ready.checks.database === 'ok', 'Readiness check verifies database connectivity');
  assert(ready.checks.sitemap === 'ok', 'Readiness check verifies sitemap is loaded');

  console.log('\n--- TEST GROUP 2: Graceful Shutdown (SIGTERM, platform stop signal) ---');

  child.kill('SIGTERM');
  const termCode = await waitForExit(child, 10000);
  assert(termCode === 0, `SIGTERM produces clean exit code 0 (got ${termCode})`);
  assert(child.stdoutData.includes('[shutdown]'), 'Shutdown logs drain/exit messages');

  console.log('\n--- TEST GROUP 3: Graceful Shutdown (SIGINT) ---');

  child = startServer({ NODE_ENV: 'development' });
  await waitUntilHealthy(child, 30000);
  child.kill('SIGINT');
  const intCode = await waitForExit(child, 10000);
  assert(intCode === 0, `SIGINT produces clean exit code 0 (got ${intCode})`);

  console.log('\n--- TEST GROUP 4: Production Fail-Fast on Missing Secrets ---');

  child = startServer({ NODE_ENV: 'production', SESSION_SECRET: undefined });
  const failCode = await waitForExit(child, 15000);
  assert(failCode !== 0, `Production without SESSION_SECRET refuses to start (exit ${failCode})`);
  assert(child.stderrData.includes('SESSION_SECRET'), 'Failure output names the missing variable');

  console.log('\n============================================================');
  console.log(`🎉 ALL ${passedTests} OF ${totalTests} TESTS PASSED SUCCESSFULLY!`);
  console.log('============================================================\n');
  process.exit(0);
}

runTestSuite().catch((err) => {
  console.error('\n❌ Test suite failed with error:', err);
  process.exit(1);
});
