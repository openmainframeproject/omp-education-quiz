/**
 * Automated Test Suite for Credly Badge & Linux Foundation Badge Claim Workflow
 */

// Set env BEFORE requiring modules: config.js snapshots process.env at load time.
const http = require('http');
const fs = require('fs');
const path = require('path');

const TEST_PORT = 3988;
process.env.PORT = String(TEST_PORT);
process.env.SESSION_SECRET = 'test-credly-secret';
process.env.ADMIN_SECRET = 'test-admin-secret-key';

const { issueBadge, CREDLY_BADGE_TEMPLATE_ID } = require('./credly-badges');

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

async function runCredlyTests() {
  console.log('\n============================================================');
  console.log('🧪 RUNNING CREDLY & LINUX FOUNDATION BADGE CLAIM TEST SUITE');
  console.log('============================================================\n');

  // Require server to initialize DB schema and start server
  require('./server.js');
  // Wait for async init to finish
  await new Promise(r => setTimeout(r, 1000));

  // -------------------------------------------------------------
  // TEST GROUP 1: credly-badges Module
  // -------------------------------------------------------------
  console.log('--- TEST GROUP 1: credly-badges Module & Simulation ---');

  assert(typeof issueBadge === 'function', 'issueBadge is an exported async function');
  assert(typeof CREDLY_BADGE_TEMPLATE_ID === 'string', 'CREDLY_BADGE_TEMPLATE_ID is defined');

  const testBadge = await issueBadge({
    email: 'learner@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    userId: 42,
  });

  assert(typeof testBadge.credlyBadgeId === 'string' && testBadge.credlyBadgeId.length > 0, 'Badge module returns valid simulated credlyBadgeId');
  assert(testBadge.acceptBadgeUrl.includes(testBadge.credlyBadgeId), 'acceptBadgeUrl points to Credly badge claim URL');

  // -------------------------------------------------------------
  // TEST GROUP 2: Database Schema & Migration
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: Database Schema & Migration ---');

  const testDb = require('./db');

  let columnNames = [];
  let claimCols = [];

  if (testDb.isPostgres) {
    const userTableInfo = await testDb.query(`SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'users'`);
    columnNames = userTableInfo.rows.map(r => r.name);
    const claimsTableInfo = await testDb.query(`SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'badge_claims'`);
    claimCols = claimsTableInfo.rows.map(r => r.name);
  } else {
    const userTableInfo = await testDb.execute(`PRAGMA table_info(users)`);
    columnNames = userTableInfo.rows.map(r => r.name);
    const claimsTableInfo = await testDb.execute(`PRAGMA table_info(badge_claims)`);
    claimCols = claimsTableInfo.rows.map(r => r.name);
  }

  // Verify users table columns
  assert(columnNames.includes('first_name'), 'users table has first_name column');
  assert(columnNames.includes('last_name'), 'users table has last_name column');

  // Verify badge_claims table exists
  assert(claimCols.includes('user_id'), 'badge_claims table has user_id column');
  assert(claimCols.includes('first_name'), 'badge_claims table has first_name column');
  assert(claimCols.includes('last_name'), 'badge_claims table has last_name column');
  assert(claimCols.includes('email'), 'badge_claims table has email column');
  assert(claimCols.includes('exam_score'), 'badge_claims table has exam_score column');
  assert(claimCols.includes('status'), 'badge_claims table has status column');
  assert(claimCols.includes('claimed_at'), 'badge_claims table has claimed_at column');

  // -------------------------------------------------------------
  // TEST GROUP 3: Server API Endpoints & Eligibility Gates
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: Server API Endpoints & Eligibility Gates ---');

  let cookieJar = '';

  function request(method, pathUrl, body = null, useCookie = true) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(`http://localhost:${TEST_PORT}${pathUrl}`);
      const headers = { 'Content-Type': 'application/json' };
      if (useCookie && cookieJar) headers['Cookie'] = cookieJar;

      const req = http.request(
        {
          method,
          host: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname + parsedUrl.search,
          headers,
        },
        (res) => {
          if (res.headers['set-cookie']) {
            cookieJar = res.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
          }
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            let json = {};
            try { json = JSON.parse(data); } catch (e) { json = data; }
            resolve({ status: res.statusCode, body: json, headers: res.headers });
          });
        }
      );
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  // 1. Unauthenticated request to /api/certification/claim
  const unauthRes = await request('POST', '/api/certification/claim', { firstName: 'A', lastName: 'B' }, false);
  assert(unauthRes.status === 401, 'Unauthenticated POST /api/certification/claim returns 401 Unauthorized');

  // 2. Register a new test user
  const testEmail = `credly_test_${Date.now()}@example.com`;
  const regRes = await request('POST', '/api/auth/register', { email: testEmail, password: 'password123' });
  assert(regRes.status === 200 && regRes.body.user, 'Registered test user successfully');

  // 3. Attempt issue with missing names
  const missingNameRes = await request('POST', '/api/certification/claim', { firstName: '', lastName: '' });
  assert(missingNameRes.status === 400, 'POST /api/certification/claim without names returns 400 Bad Request');

  // 4. Attempt issue when ineligible (0% progress)
  const ineligRes = await request('POST', '/api/certification/claim', { firstName: 'Grace', lastName: 'Hopper', score: 95 });
  assert(ineligRes.status === 403, 'Ineligible user (0/40 progress) returns 403 Forbidden with progress error');

  // 5. Add 35 completed quiz pages for this user to meet 80% eligibility gate
  const quizzesRaw = fs.readFileSync(path.join(__dirname, 'public', 'quizzes.json'), 'utf-8');
  const allQuizUrls = Object.keys(JSON.parse(quizzesRaw));
  const thirtyFiveQuizzes = allQuizUrls.slice(0, 35);
  await request('POST', '/api/progress/sync', { pages: thirtyFiveQuizzes });

  // 6. Check badge status before claim
  const statusPreRes = await request('GET', '/api/certification/status');
  assert(statusPreRes.status === 200 && statusPreRes.body.claimed === false, 'GET /api/certification/status returns claimed: false before claim');

  // 7. Claim badge with valid eligibility and name
  const claimRes = await request('POST', '/api/certification/claim', { firstName: 'Grace', lastName: 'Hopper', score: 95 });
  assert(claimRes.status === 200, 'Eligible user claim returns HTTP 200 OK');
  assert(claimRes.body.alreadyClaimed === false, 'First-time claim has alreadyClaimed: false');
  assert(claimRes.body.firstName === 'Grace' && claimRes.body.email === testEmail, 'Claim response contains candidate name and email');
  assert(claimRes.body.status === 'pending', 'Claim status initialized to pending');

  // 8. Verify user profile was updated with first and last name
  const meRes = await request('GET', '/api/auth/me');
  assert(meRes.body.user.firstName === 'Grace' && meRes.body.user.lastName === 'Hopper', 'GET /api/auth/me reflects saved first and last name');

  // 9. Check badge status after claim
  const statusPostRes = await request('GET', '/api/certification/status');
  assert(statusPostRes.status === 200 && statusPostRes.body.claimed === true, 'GET /api/certification/status returns claimed: true after claim');
  assert(statusPostRes.body.firstName === 'Grace' && statusPostRes.body.examScore === 95, 'Status details reflect recorded candidate data');

  // 10. Attempt duplicate claim (deduplication check)
  const dupClaimRes = await request('POST', '/api/certification/claim', { firstName: 'Grace', lastName: 'Hopper', score: 95 });
  assert(dupClaimRes.status === 200, 'Duplicate claim returns HTTP 200 OK');
  assert(dupClaimRes.body.alreadyClaimed === true, 'Duplicate claim returns alreadyClaimed: true');

  // -------------------------------------------------------------
  // TEST GROUP 4: Admin Reporting & Export for Linux Foundation
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: Admin Reporting & CSV Export for Linux Foundation ---');

  // 11. Admin JSON export
  const adminRes = await request('GET', '/api/admin/badge-claims?secret=test-admin-secret-key');
  assert(adminRes.status === 200 && Array.isArray(adminRes.body.claims), 'GET /api/admin/badge-claims returns array of candidate claims');
  assert(adminRes.body.claims.some(c => c.email === testEmail && c.first_name === 'Grace'), 'Admin claims contains newly recorded candidate');

  // 12. Admin CSV export
  const csvRes = await request('GET', '/api/admin/badge-claims?secret=test-admin-secret-key&format=csv');
  assert(csvRes.status === 200 && typeof csvRes.body === 'string', 'Admin CSV export returns text/csv content');
  assert(csvRes.body.includes('First Name,Last Name,Email,Exam Score,Status,Claimed Date'), 'CSV has standard candidate headers for Linux Foundation');
  assert(csvRes.body.includes('Grace') && csvRes.body.includes(testEmail), 'CSV contains candidate record');

  console.log('\n============================================================');
  console.log(`🎉 ALL ${passedTests} OF ${totalTests} BADGE CLAIM TESTS PASSED SUCCESSFULLY!`);
  console.log('============================================================\n');

  process.exit(0);
}

runCredlyTests().catch(err => {
  console.error('\n❌ Credly test suite failed with error:', err);
  process.exit(1);
});
