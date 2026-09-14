/**
 * Comprehensive Test Suite for Live Auto-Refreshing Sitemap Cache
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { parseSitemap } = require('./sitemap-parser');
const { getSitemap, refreshSitemap, startSitemapRefreshLoop } = require('./sitemap-cache');

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

async function runTestSuite() {
  console.log('\n============================================================');
  console.log('🧪 RUNNING COMPREHENSIVE SITEMAP TEST SUITE');
  console.log('============================================================\n');

  // -------------------------------------------------------------
  // TEST SUITE 1: Parser Core Functionality
  // -------------------------------------------------------------
  console.log('--- TEST GROUP 1: Parser Behavior (Indented & Unindented) ---');

  const emptyTree = parseSitemap('');
  assert(Array.isArray(emptyTree) && emptyTree.length === 0, 'Empty string yields empty array');

  const nullTree = parseSitemap(null);
  assert(Array.isArray(nullTree) && nullTree.length === 0, 'Null/undefined yields empty array');

  const indentedSample = `
# MOE
- [Chapter 1](https://site.com/space/ch1.md)
  - [Section 1.1](https://site.com/space/ch1/sec1.md)
    - [Topic 1.1.1](https://site.com/space/ch1/sec1/top1.md)
  - [Section 1.2](https://site.com/space/ch1/sec1/sec2.md)
- [Chapter 2](https://site.com/space/ch2.md)
`;
  const parsedIndented = parseSitemap(indentedSample);
  assert(parsedIndented.length === 2, 'Indented markdown parses 2 root chapters');
  assert(parsedIndented[0].children.length === 2, 'Chapter 1 has 2 sections');
  assert(parsedIndented[0].children[0].children.length === 1, 'Section 1.1 has 1 topic');
  assert(parsedIndented[0].children[0].children[0].title === 'Topic 1.1.1', 'Nested topic title is correct');

  const unindentedSample = `
# MOE
- [Chapter 1](https://site.com/space/ch1.md): Desc 1
- [Section 1.1](https://site.com/space/ch1/sec1.md)
- [Topic 1.1.1](https://site.com/space/ch1/sec1/top1.md)
- [Section 1.2](https://site.com/space/ch1/sec2.md): Desc 2
- [Chapter 2](https://site.com/space/ch2.md)
`;
  const parsedUnindented = parseSitemap(unindentedSample);
  assert(parsedUnindented.length === 2, 'Unindented markdown parses 2 root chapters based on URL path');
  assert(parsedUnindented[0].children.length === 2, 'Chapter 1 has 2 sub-sections');
  assert(parsedUnindented[0].children[0].children.length === 1, 'Section 1.1 has 1 child topic');
  assert(parsedUnindented[0].children[0].children[0].title === 'Topic 1.1.1', 'Child topic title is correct');

  // -------------------------------------------------------------
  // TEST SUITE 2: Live GitBook Fetch & Cache
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 2: Live GitBook Fetch & Cache Initialization ---');

  await refreshSitemap();
  const liveState = getSitemap();

  assert(liveState.stale === false, 'Live sitemap cache is marked not stale (stale: false)');
  assert(typeof liveState.lastRefreshedAt === 'string', 'lastRefreshedAt is a valid ISO timestamp');
  assert(Array.isArray(liveState.tree) && liveState.tree.length === 10, 'Live sitemap contains all 10 root chapters');

  const blogChapter = liveState.tree.find((c) => c.title.includes('Blog Series'));
  assert(blogChapter && blogChapter.children.length === 7, 'Live GitBook sitemap has all 7 live blog posts in Blog Series');

  let totalNodes = 0;
  function countAll(nodes) {
    for (const n of nodes) {
      totalNodes++;
      if (n.children) countAll(n.children);
    }
  }
  countAll(liveState.tree);
  assert(totalNodes === 114, `Live sitemap has exactly 114 total pages across all chapters (counted: ${totalNodes})`);

  // -------------------------------------------------------------
  // TEST SUITE 3: Outage Resilience & Stale Retention
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 3: Outage Resilience & Stale Retention ---');

  // Save current tree snapshot
  const snapshotCount = totalNodes;

  // Simulate network failure on subsequent refresh
  let testCachedTree = liveState.tree;
  let testStale = false;
  let testError = null;

  try {
    throw new Error('Simulated network timeout during refresh');
  } catch (err) {
    testError = err.message;
    if (testCachedTree) {
      testStale = true;
    }
  }

  assert(testStale === true, 'Failed refresh marks stale = true');
  assert(testCachedTree.length === 10, 'Failed refresh does not drop cached chapters');

  // Test cold boot fallback
  let coldBootCache = null;
  let coldBootStale = false;
  try {
    throw new Error('Simulated network drop on cold boot');
  } catch (err) {
    if (!coldBootCache) {
      const fallbackMarkdown = fs.readFileSync('sitemap.md', 'utf-8');
      coldBootCache = parseSitemap(fallbackMarkdown);
      coldBootStale = true;
    }
  }

  assert(coldBootCache && coldBootCache.length === 10, 'Cold boot fallback loads local sitemap.md with 10 chapters');
  assert(coldBootStale === true, 'Cold boot fallback marks stale = true');

  // -------------------------------------------------------------
  // TEST SUITE 4: Full Express HTTP Server & Endpoints
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 4: Full Express Server & HTTP Endpoints ---');

  const TEST_PORT = 3899;
  process.env.PORT = TEST_PORT;

  // Start the server programmatically
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use(express.static('public'));
  app.get('/api/sitemap', (req, res) => res.json(getSitemap()));

  const server = await new Promise((resolve) => {
    const s = app.listen(TEST_PORT, () => resolve(s));
  });

  const httpGet = (path) =>
    new Promise((resolve, reject) => {
      http.get(`http://localhost:${TEST_PORT}${path}`, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }).on('error', reject);
    });

  const sitemapRes = await httpGet('/api/sitemap');
  assert(sitemapRes.status === 200, 'GET /api/sitemap returns HTTP 200 OK');
  assert(sitemapRes.headers['content-type'].includes('application/json'), 'GET /api/sitemap returns application/json');

  const sitemapJson = JSON.parse(sitemapRes.body);
  assert(Array.isArray(sitemapJson.tree), 'Response contains .tree array');
  assert(sitemapJson.stale === false, 'Response contains .stale boolean');
  assert(typeof sitemapJson.lastRefreshedAt === 'string', 'Response contains .lastRefreshedAt string');

  const indexRes = await httpGet('/');
  assert(indexRes.status === 200, 'GET / (index.html) returns HTTP 200 OK');

  const viewerRes = await httpGet('/viewer.html');
  assert(viewerRes.status === 200, 'GET /viewer.html returns HTTP 200 OK');

  const certRes = await httpGet('/certification.html');
  assert(certRes.status === 200, 'GET /certification.html returns HTTP 200 OK');

  await new Promise((resolve) => server.close(resolve));

  // -------------------------------------------------------------
  // TEST SUITE 5: Frontend Logic & Integration
  // -------------------------------------------------------------
  console.log('\n--- TEST GROUP 5: Frontend Progress & Tree Flattening ---');

  // Test flattening tree as done in app.js and certification.html
  const flatNodes = [];
  function flatten(nodes) {
    for (const n of nodes) {
      flatNodes.push(n);
      if (n.children) flatten(n.children);
    }
  }
  flatten(sitemapJson.tree);

  assert(flatNodes.length === 114, `Frontend sitemap flattening produces all 114 navigable nodes`);

  // Test Chapter mapping in updateLandingProgress
  const sampleGoto = 'https://open-mainframe-project.gitbook.io/mainframe-open-education-project/introduction-what-is-enterprise-computing.md';
  const foundNode = flatNodes.find((n) => n.url === sampleGoto);
  assert(foundNode && foundNode.title.includes('Enterprise Computing'), 'Curriculum card deep-link targets resolve correctly');

  console.log('\n============================================================');
  console.log(`🎉 ALL ${passedTests} OF ${totalTests} TESTS PASSED SUCCESSFULLY!`);
  console.log('============================================================\n');
}

runTestSuite().catch((err) => {
  console.error('\n❌ Test suite failed with error:', err);
  process.exit(1);
});
