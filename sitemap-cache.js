const fs = require('fs');
const path = require('path');
const { parseSitemap } = require('./sitemap-parser');
const { config } = require('./config');

const LLMS_URL = `${config.gitbookBase}${config.llmsTxtPath}`;
const FETCH_TIMEOUT_MS = config.fetchTimeoutMs;
const REFRESH_INTERVAL_MS = config.sitemapRefreshMs;

let cachedTree = null;
let lastRefreshedAt = null;
let lastError = null;
let isStale = false;
let refreshTimer = null;

/**
 * Counts total nodes recursively in the tree.
 */
function countTreeNodes(nodes) {
  let count = 0;
  for (const n of nodes) {
    count += 1 + (n.children ? countTreeNodes(n.children) : 0);
  }
  return count;
}

/**
 * Fetches raw llms.txt from live GitBook with 15s timeout and User-Agent.
 */
async function fetchLiveLlmsTxt() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(LLMS_URL, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MOE-Viewer/1.0)',
        'Accept': 'text/plain, text/markdown, text/html',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads and parses the static fallback sitemap.md file.
 */
function loadFallbackSitemap() {
  const fallbackPath = path.join(__dirname, 'sitemap.md');
  const markdown = fs.readFileSync(fallbackPath, 'utf-8');
  return parseSitemap(markdown);
}

/**
 * Performs a single sitemap refresh.
 * Updates cache if successful; preserves existing cache on error.
 */
async function refreshSitemap() {
  try {
    const rawText = await fetchLiveLlmsTxt();
    const tree = parseSitemap(rawText);

    if (!tree || tree.length === 0) {
      throw new Error('Parsed sitemap tree is empty');
    }

    cachedTree = tree;
    lastRefreshedAt = new Date();
    lastError = null;
    isStale = false;

    const nodeCount = countTreeNodes(tree);
    console.log(`[sitemap] refreshed live from GitBook at ${lastRefreshedAt.toISOString()} (${nodeCount} pages across ${tree.length} chapters)`);
  } catch (err) {
    lastError = err.message || String(err);

    if (cachedTree) {
      isStale = true;
      console.warn(`[sitemap] live refresh failed, keeping previous cache: ${lastError}`);
    } else {
      // Cold boot with GitBook unreachable - load static sitemap.md fallback
      try {
        cachedTree = loadFallbackSitemap();
        lastRefreshedAt = new Date();
        isStale = true;
        const nodeCount = countTreeNodes(cachedTree);
        console.warn(`[sitemap] live refresh failed on cold boot, fell back to local sitemap.md: ${lastError} (${nodeCount} pages)`);
      } catch (fallbackErr) {
        console.error(`[sitemap] critical: failed to load local fallback sitemap.md:`, fallbackErr);
        throw fallbackErr;
      }
    }
  }
}

/**
 * Starts the periodic sitemap refresh loop.
 * Runs one initial refresh immediately before returning.
 */
async function startSitemapRefreshLoop() {
  await refreshSitemap();

  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  refreshTimer = setInterval(() => {
    refreshSitemap().catch((err) => {
      console.error('[sitemap] unexpected error in refresh loop:', err);
    });
  }, REFRESH_INTERVAL_MS);

  if (refreshTimer.unref) {
    refreshTimer.unref();
  }
}

/**
 * Returns the current sitemap state.
 */
function getSitemap() {
  return {
    tree: cachedTree || [],
    lastRefreshedAt: lastRefreshedAt ? lastRefreshedAt.toISOString() : null,
    stale: isStale,
  };
}

/**
 * Stops the periodic refresh loop (used by graceful shutdown).
 */
function stopSitemapRefreshLoop() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

module.exports = {
  getSitemap,
  startSitemapRefreshLoop,
  stopSitemapRefreshLoop,
  refreshSitemap,
};
