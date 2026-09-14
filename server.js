const express = require('express');
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { createClient } = require('@libsql/client');
const { parseSitemap } = require('./sitemap-parser');
const { getSitemap, startSitemapRefreshLoop, stopSitemapRefreshLoop } = require('./sitemap-cache');
const { issueBadge, CREDLY_BADGE_TEMPLATE_ID } = require('./credly-badges');
const { config, productionConfigProblems } = require('./config');

const app = express();
const PORT = config.port;

app.use(express.json());
// TRUST_PROXY-aware setting so secure cookies work behind any platform's HTTPS proxy
app.set('trust proxy', config.trustProxy);
app.use(express.static('public'));
app.use('/logo', express.static(path.join(__dirname, 'logo')));

const GITBOOK_BASE = config.gitbookBase;
const FETCH_TIMEOUT = config.fetchTimeoutMs;

/* ── Account system (email + password) ═══════════════════════════════════ */

const db = require('./db');
const SESSION_SECRET = config.sessionSecret;

const sessionConfig = {
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    // 'auto' resolves against TRUST_PROXY + X-Forwarded-Proto, so cookies are
    // secure behind any platform's TLS edge while still working over plain
    // HTTP in containers / internal networks.
    secure: 'auto',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
};

if (db.isPostgres && db.pool !== undefined) {
  try {
    const pgSession = require('connect-pg-simple')(session);
    sessionConfig.store = new pgSession({
      // Delegating handle: always routes to the live pool even if the SSL
      // fallback in db.js swaps the underlying Pool instance.
      pool: { query: async (...args) => (await db.getPool()).query(...args) },
      tableName: 'session',
      createTableIfMissing: true,
    });
  } catch (e) {
    console.warn('[session] pgSession store warning:', e.message);
  }
}

app.use(session(sessionConfig));

/* ── Platform-neutral health endpoints ════════════════════════════════════ */

const startedAt = Date.now();

app.get('/healthz', (req, res) => {
  res.json({ ok: true, env: config.env, uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) });
});

app.get('/readyz', async (req, res) => {
  const checks = { database: 'ok', sitemap: 'ok' };

  try {
    await db.execute({ sql: 'SELECT 1', args: [] });
  } catch (err) {
    checks.database = `error: ${err.message}`;
  }

  const sm = getSitemap();
  if (!sm.tree || sm.tree.length === 0) checks.sitemap = 'error: sitemap not loaded';

  const ok = Object.values(checks).every(v => v === 'ok');
  res.status(ok ? 200 : 503).json({ ok, checks });
});

function sanitizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateCredentials(email, password) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  if (!password || String(password).length < 6) return 'Password must be at least 6 characters.';
  return null;
}

// Minimal in-memory rate limiter for auth endpoints (brute-force guard).
const authAttempts = new Map();
function rateLimitAuth(key) {
  const now = Date.now();
  const rec = authAttempts.get(key) || { count: 0, reset: now + 15 * 60 * 1000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 15 * 60 * 1000; }
  rec.count += 1;
  authAttempts.set(key, rec);
  if (rec.count > 10) return 'Too many attempts. Please try again later.';
  return null;
}

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

async function insertProgressBatch(userId, pages) {
  for (const pageUrl of pages) {
    const cleanUrl = (pageUrl || '').toString().trim().replace(/[:]+$/, '');
    if (!cleanUrl) continue;
    await db.execute({
      sql: 'INSERT INTO progress (user_id, page_url) VALUES (?, ?) ON CONFLICT (user_id, page_url) DO NOTHING',
      args: [userId, cleanUrl],
    });
  }
}

async function initUserSchema() {
  await db.initSchema();
}

/* ── Auth endpoints ─────────────────────────────────────────────────────── */

app.post('/api/auth/register', async (req, res) => {
  try {
    const email = sanitizeEmail(req.body.email);
    const password = req.body.password;
    const limit = rateLimitAuth(`reg:${email}:${req.ip}`);
    if (limit) return res.status(429).json({ error: limit });

    const invalid = validateCredentials(email, password);
    if (invalid) return res.status(400).json({ error: invalid });

    const existing = await db.execute({
      sql: 'SELECT id FROM users WHERE email = ? LIMIT 1',
      args: [email],
    });
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with that email already exists. Try logging in.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const out = await db.execute({
      sql: 'INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING id',
      args: [email, passwordHash],
    });
    const userId = out.rows[0].id;
    req.session.userId = userId;
    req.session.email = email;
    res.json({ user: { id: userId, email } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed', detail: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = sanitizeEmail(req.body.email);
    const password = req.body.password;
    const limit = rateLimitAuth(`login:${email}:${req.ip}`);
    if (limit) return res.status(429).json({ error: limit });

    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const out = await db.execute({
      sql: 'SELECT id, email, password_hash FROM users WHERE email = ? LIMIT 1',
      args: [email],
    });
    const row = out.rows[0];
    const ok = row && await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });

    req.session.userId = row.id;
    req.session.email = row.email;
    res.json({ user: { id: row.id, email: row.email } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed', detail: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

app.get('/api/auth/me', async (req, res) => {
  if (req.session && req.session.userId) {
    try {
      const out = await db.execute({
        sql: 'SELECT id, email, first_name, last_name FROM users WHERE id = ? LIMIT 1',
        args: [req.session.userId],
      });
      const row = out.rows[0];
      if (row) {
        return res.json({
          user: {
            id: row.id,
            email: row.email,
            firstName: row.first_name || null,
            lastName: row.last_name || null,
          },
        });
      }
    } catch (e) {
      // fallback to session info
    }
    res.json({ user: { id: req.session.userId, email: req.session.email } });
  } else {
    res.json({ user: null });
  }
});

/* ── Progress endpoints (auth required) ────────────────────────────────── */

app.get('/api/progress', requireAuth, async (req, res) => {
  try {
    const out = await db.execute({
      sql: 'SELECT page_url FROM progress WHERE user_id = ?',
      args: [req.session.userId],
    });
    res.json({ pages: out.rows.map(r => r.page_url) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load progress', detail: err.message });
  }
});

app.post('/api/progress', requireAuth, async (req, res) => {
  try {
    const pageUrl = req.body && req.body.pageUrl ? String(req.body.pageUrl).trim().replace(/[:]+$/, '') : null;
    if (!pageUrl) return res.status(400).json({ error: 'pageUrl is required' });
    await db.execute({
      sql: 'INSERT INTO progress (user_id, page_url) VALUES (?, ?) ON CONFLICT (user_id, page_url) DO NOTHING',
      args: [req.session.userId, pageUrl],
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save progress', detail: err.message });
  }
});

app.post('/api/progress/sync', requireAuth, async (req, res) => {
  try {
    const pages = Array.isArray(req.body && req.body.pages) ? req.body.pages : [];
    await db.execute({ sql: 'DELETE FROM progress WHERE user_id = ?', args: [req.session.userId] });
    await insertProgressBatch(req.session.userId, pages);
    res.json({ ok: true, count: pages.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to sync progress', detail: err.message });
  }
});

async function fetchUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MOE-Viewer/1.0)',
        'Accept': 'text/html, text/markdown, text/plain, application/json',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function fixImageUrls(text, baseUrl) {
  const base = baseUrl.replace(/\/[^/]*\.md$/, '').replace(/\/[^/]*$/, '');
  const root = GITBOOK_BASE;

  return text
    .replace(/(\()\/(?!\/)([^)]+)\)/g, (match, open, urlPath) => {
      if (urlPath.startsWith('api/')) return match;
      if (urlPath.startsWith('files/')) {
        const fileId = urlPath.replace('files/', '');
        return `${open}/api/file/${fileId})`;
      }
      if (urlPath.startsWith('~gitbook/')) {
        return `${open}${root}/${urlPath})`;
      }
      if (urlPath.match(/^[a-zA-Z0-9_-]+\//) || urlPath.match(/^pages\//)) {
        return `${open}${root}/${urlPath})`;
      }
      return match;
    })
    .replace(/(src=")\/(?!\/)([^"]+)"/g, (match, open, urlPath) => {
      if (urlPath.startsWith('api/')) return match;
      if (urlPath.startsWith('files/')) {
        const fileId = urlPath.replace('files/', '');
        return `${open}/api/file/${fileId}"`;
      }
      if (urlPath.startsWith('~gitbook/')) {
        return `${open}${root}/${urlPath}"`;
      }
      return `${open}${base}/${urlPath}"`;
    })
    .replace(/(href=")\/(?!\/)([^"]+)"/g, (match, open, urlPath) => {
      if (urlPath.startsWith('api/')) return match;
      if (urlPath.startsWith('files/')) {
        const fileId = urlPath.replace('files/', '');
        return `${open}/api/file/${fileId}"`;
      }
      if (urlPath.startsWith('~gitbook/')) {
        return `${open}${root}/${urlPath}"`;
      }
      return `${open}${base}/${urlPath}"`;
    });
}

function normalizeEmbedUrl(url) {
  return url.trim()
    .replace(/^(&lt;|<)|(&gt;|>)$/g, '')
    .replace(/^"|"$/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
}

function escapeHtmlAttr(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getYouTubeEmbedUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
      const videoId = parsed.pathname.split('/').filter(Boolean)[0];
      return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
    }

    if (host.endsWith('youtube.com')) {
      const videoId = parsed.searchParams.get('v') || parsed.pathname.split('/').filter(Boolean).pop();
      return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
    }
  } catch (err) {
    return null;
  }

  return null;
}

function renderEmbedBlock(url, label) {
  const cleanUrl = normalizeEmbedUrl(url);
  const caption = (label || '').trim();
  const safeCaption = escapeHtmlAttr(caption || 'Open in GitBook');

  if (/\.(png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(cleanUrl)) {
    return `<figure class="embed embed-image"><img src="${escapeHtmlAttr(cleanUrl)}" alt="${safeCaption}"></figure>`;
  }

  const youtubeEmbedUrl = getYouTubeEmbedUrl(cleanUrl);
  if (youtubeEmbedUrl) {
    return `<div class="embed embed-video"><iframe src="${escapeHtmlAttr(youtubeEmbedUrl)}" title="${safeCaption}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`;
  }

  const displayUrl = cleanUrl.length > 80 ? cleanUrl.substring(0, 77) + '...' : cleanUrl;
  const labelHtml = caption ? `<div class="embed-link-label">${safeCaption}</div>` : '';
  return `<div class="embed embed-link">${labelHtml}<a href="${escapeHtmlAttr(cleanUrl)}" class="embed-link-url" target="_blank" rel="noopener">${escapeHtmlAttr(displayUrl)}</a></div>`;
}

function replaceGitBookRoleTables(text) {
  const startRegex = /<div[^>]*role="table"[^>]*>/g;
  const result = [];
  let lastIndex = 0;
  let match;

  const findMatchingDiv = (html, startPos) => {
    let depth = 1;
    let p = startPos;
    while (depth > 0 && p < html.length) {
      const no = html.indexOf('<div', p);
      const nc = html.indexOf('</div>', p);
      if (nc === -1) break;
      if (no !== -1 && no < nc) { depth++; p = no + 4; }
      else { depth--; p = nc + 6; }
    }
    return { html: html.substring(startPos, p - 6), end: p };
  };

  const findAllByRole = (html, role) => {
    const results = [];
    const re = new RegExp(`<div[^>]*role="${role}"[^>]*>`, 'g');
    let m;
    while ((m = re.exec(html)) !== null) {
      const { html: content } = findMatchingDiv(html, m.index + m[0].length);
      results.push({ full: html.substring(m.index, m.index + m[0].length + content.length + 6), content });
    }
    return results;
  };

  const cleanCell = (raw) => {
    let s = raw.replace(/<div[^>]*class="blocks[^"]*"[^>]*>/, '');
    s = s.replace(/<\/(?:div|p)>/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    return s;
  };

  while ((match = startRegex.exec(text)) !== null) {
    const start = match.index;
    const { html: tableHtml } = findMatchingDiv(text, start + match[0].length);

    const headerCells = findAllByRole(tableHtml, 'columnheader');
    const rows = findAllByRole(tableHtml, 'row').filter(
      r => r.full.indexOf('role="cell"') !== -1 || r.full.indexOf('role="columnheader"') !== -1
    );
    if (rows.length === 0) continue;

    let html = '<div class="table-wrapper"><table>';
    if (headerCells.length > 0) {
      html += '<thead><tr>';
      for (const hc of headerCells) html += '<th>' + cleanCell(hc.content) + '</th>';
      html += '</tr></thead>';
    }
    html += '<tbody>';
    for (const row of rows) {
      const cells = findAllByRole(row.full, 'cell');
      if (cells.length === 0 && row.full.indexOf('role="columnheader"') !== -1) continue;
      if (cells.length === 0) continue;
      html += '<tr>';
      for (const c of cells) html += '<td>' + cleanCell(c.content) + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    result.push(text.substring(lastIndex, start));
    result.push(html);
    lastIndex = start + match[0].length + tableHtml.length + 6;
  }
  result.push(text.substring(lastIndex));
  return result.join('');
}

function replaceGitBookFileCards(text) {
  const startRegex = /<div class="decoration-primary\/6 max-w-3xl w-full[^"]*"[^>]*>/g;
  const result = [];
  let lastIndex = 0;
  let match;
  while ((match = startRegex.exec(text)) !== null) {
    const start = match.index;
    const openTag = match[0];
    let depth = 1;
    let pos = start + openTag.length;
    while (depth > 0 && pos < text.length) {
      const nextOpen = text.indexOf('<div', pos);
      const nextClose = text.indexOf('</div>', pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) { depth++; pos = nextOpen + 4; }
      else { depth--; pos = nextClose + 6; }
    }
    const cardHtml = text.substring(start, pos);
    const isFileCard = /\d+\s*(?:KB|MB|GB)/.test(cardHtml) && /\.(pdf|docx?|xlsx?|pptx?|zip|txt|png|jpg|jpeg|gif|mp4|mov|avi|mkv|webm)/i.test(cardHtml);
    if (!isFileCard) continue;
    const sizeMatch = cardHtml.match(/(\d+(?:\.\d+)?\s*(?:KB|MB|GB))/);
    const fileSize = sizeMatch ? sizeMatch[1] : '';
    const linkMatch = cardHtml.match(/<a[^>]*href="([^"]*)"[^>]*>([^<]+\.(?:pdf|docx?|xlsx?|pptx?|zip|txt|png|jpg|jpeg|gif|mp4|mov|avi|mkv|webm))<\/a>/i);
    if (!linkMatch) continue;
    const fileUrl = linkMatch[1];
    const fileName = linkMatch[2];
    const extMatch = fileName.match(/\.(\w+)$/);
    const fileType = extMatch ? extMatch[1].toUpperCase() : '';
    const isVideo = /^MP4|MOV|AVI|MKV|WEBM$/.test(fileType);
    if (isVideo) {
      result.push(text.substring(lastIndex, start));
      result.push(`<div class="file-video"><video controls preload="metadata" width="100%"><source src="${escapeHtmlAttr(fileUrl)}" type="video/${fileType.toLowerCase()}"></video><div class="file-video-info"><a href="${fileUrl}" class="file-name">${fileName}</a><span class="file-size">${fileSize} — ${fileType}</span><a href="${fileUrl}" class="file-download" download>Download</a></div></div>`);
      lastIndex = pos;
      continue;
    }
    const icon = '\uD83D\uDCC4';
    result.push(text.substring(lastIndex, start));
    result.push(`<div class="file-card"><div class="file-icon">${icon}</div><div class="file-info"><a href="${fileUrl}" class="file-name">${fileName}</a><span class="file-size">${fileSize} — ${fileType}</span></div><a href="${fileUrl}" class="file-download">Download</a></div>`);
    lastIndex = pos;
  }
  result.push(text.substring(lastIndex));
  return result.join('');
}

function simplifyGitBookLists(text) {
  const listRegex = /<(ul|ol)[^>]*class="[^"]*decoration-primary\/6[^"]*"[^>]*>([\s\S]*?)<\/\1>/g;
  return text.replace(listRegex, (match, tag, inner) => {
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/g;
    const items = [];
    let liMatch;
    while ((liMatch = liRegex.exec(inner)) !== null) {
      let liInner = liMatch[1];
      const contentMatch = liInner.match(/<div[^>]*class="[^"]*flex[^"]*min-w-0[^"]*flex-1[^"]*"[^>]*>([\s\S]*)<\/div>\s*$/);
      if (contentMatch) {
        liInner = contentMatch[1];
      } else {
        liInner = liInner.replace(/<[^>]+>/g, '').trim();
      }
      items.push(`<li>${liInner.trim()}</li>`);
    }
    return items.length ? `<${tag}>${items.join('')}</${tag}>` : match;
  });
}

function preprocessGitBookFlavoredMd(raw, pageUrl) {
  let text = raw;

  // Decode HTML entities (order matters: &amp; first so &amp;lt; becomes &lt;)
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

  // Simplify GitBook complex list HTML to standard <ul>/<ol>/<li>
  text = simplifyGitBookLists(text);

  // Handle file embeds ({% file src="..." %}...{% endfile %})
  text = text.replace(/{%\s*file\s+src="([^"]+)"\s*%}([\s\S]*?){%\s*endfile\s*%}/g, (match, src, label) => {
    const fileId = src.replace(/^\/files\//, '');
    const fileName = (label || '').trim() || 'File';
    const isVideo = /\.(mp4|mov|avi|mkv|webm)$/i.test(fileName);
    if (isVideo) {
      return `<div class="file-video"><video controls preload="metadata" width="100%"><source src="/api/file/${fileId}" type="video/${fileName.split('.').pop().toLowerCase()}"></video><div class="file-video-info"><a href="/api/file/${fileId}" class="file-name">${fileName}</a><a href="/api/file/${fileId}" class="file-download" download>Download</a></div></div>`;
    }
    return `<div class="file-card"><div class="file-icon">\uD83D\uDCC4</div><div class="file-info"><a href="/api/file/${fileId}" class="file-name">${fileName}</a></div><a href="/api/file/${fileId}" class="file-download">Download</a></div>`;
  });
  // Handle self-closing file embeds ({% file src="..." %} with no endfile)
  text = text.replace(/{%\s*file\s+src="([^"]+)"\s*%}(?![\s\S]*?{%\s*endfile\s*%})/g, (match, src) => {
    const fileId = src.replace(/^\/files\//, '');
    return `<div class="file-card"><div class="file-icon">\uD83D\uDCC4</div><div class="file-info"><a href="/api/file/${fileId}" class="file-name">File</a></div><a href="/api/file/${fileId}" class="file-download">Download</a></div>`;
  });

  // Handle stepper ({% stepper %}...{% endstepper %} with {% step %}...{% endstep %})
  text = text.replace(/{%\s*stepper\s*%}([\s\S]*?){%\s*endstepper\s*%}/g, (match, content) => {
    const steps = content.match(/{%\s*step\s*%}([\s\S]*?){%\s*endstep\s*%}/g);
    if (!steps) return '';
    return steps.map((s, i) => {
      const inner = s.replace(/{%\s*step\s*%}|{%\s*endstep\s*%}/g, '').trim();
      return `${i + 1}. ${inner.replace(/\n\n+/g, '\n   ')}`;
    }).join('\n\n');
  });

  // Handle embeds with content ({% embed %}...{% endembed %})
  text = text.replace(/{%\s*embed\s+url="([^"]+)"\s*%}([\s\S]*?){%\s*endembed\s*%}/g, (match, url, label) => {
    return renderEmbedBlock(url, label || '');
  });
  // Handle self-closing embeds ({% embed url="..." %} with no endembed)
  text = text.replace(/{%\s*embed\s+url="([^"]+)"\s*%}/g, (match, url) => {
    return renderEmbedBlock(url, '');
  });

  text = text.replace(/{%\s*hint\s+(?:style=")?(\w+)"?\s*%}([\s\S]*?){%\s*endhint\s*%}/g, (match, type, content) => {
    const symbols = { danger: '\u26A0\uFE0F', warning: '\u26A0\uFE0F', info: '\u2139\uFE0F', success: '\u2705' };
    const symbol = symbols[type] || '\u2139\uFE0F';
    return `> ${symbol} ${content.trim().replace(/\n/g, '\n> ')}\n`;
  });

  text = text.replace(/{%\s*columns\s*%}([\s\S]*?){%\s*endcolumns\s*%}/g, (match, content) => {
    const cols = content.match(/{%\s*column\s+width="([^"]*)"[^%]*%}([\s\S]*?){%\s*endcolumn\s*%}/g);
    if (!cols) return '';
    return cols.map(c => {
      const m = c.match(/width="([^"]*)"[^%]*%}([\s\S]*?){%\s*endcolumn\s*%}/);
      if (!m) return '';
      return m[2].trim();
    }).join('\n\n');
  });

  text = text.replace(/<table[\s\S]*?<\/table>/g, (match) => {
    const tagName = (match.match(/<table[^>]*>/i) || [''])[0];
    const hasHeader = /<th>/i.test(match);

    const rows = match.match(/<tr>[\s\S]*?<\/tr>/gi);
    if (!rows) return '';

    const cleanRows = rows.map(row => {
      const cells = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi);
      if (!cells) return null;

      const cleaned = cells.map(c => {
        const keepTags = ['a', 'strong', 'b', 'em', 'i', 'code', 'span'];
        let cell = c
          .replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, '$1')
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<\/?([a-z]+)[^>]*>/gi, (m, tag) => keepTags.includes(tag.toLowerCase()) ? m : '')
          .replace(/\n/g, ' ').trim();
        return cell;
      });

      return cleaned;
    }).filter(Boolean);

    if (cleanRows.length === 0) return '';

    let htmlTable = '<div class="table-wrapper"><table>';
    if (hasHeader && cleanRows.length > 0) {
      htmlTable += '<thead><tr>' + cleanRows[0].map(c => `<th>${c}</th>`).join('') + '</tr></thead>';
      htmlTable += '<tbody>' + cleanRows.slice(1).map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody>';
    } else {
      htmlTable += cleanRows.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('');
    }
    htmlTable += '</table></div>';

    return htmlTable;
  });

  text = text.replace(/<figure>([\s\S]*?)<\/figure>/g, (match, inner) => {
    const imgMatch = inner.match(/<img[^>]+src="([^"]+)"[^>]*(?:alt="([^"]*)")?[^>]*>/);
    if (!imgMatch) return match;
    const src = imgMatch[1];
    const alt = (imgMatch[2] || '').replace(/"/g, '&quot;');
    const captionMatch = inner.match(/<figcaption>([\s\S]*?)<\/figcaption>/);
    const imgTag = `<img src="${src}" alt="${alt}" style="max-width:100%;border-radius:8px;margin:16px 0">`;
    if (captionMatch) {
      const caption = captionMatch[1].trim();
      return `<figure>${imgTag}<figcaption>${caption}</figcaption></figure>`;
    }
    return imgTag;
  });

  text = text.replace(/<mark[^>]*>([\s\S]*?)<\/mark>/g, '$1');

  text = text.replace(/&#x20;/g, ' ');

  // Handle GitBook picture-based video file cards (<picture> with .mp4/.mov/etc.)
  text = text.replace(/<picture[^>]*class="[^"]*decoration-primary\/6[^"]*"[^>]*>([\s\S]*?)<\/picture>/g, (match, inner) => {
    const linkMatch = inner.match(/<a[^>]*href="([^"]+)"[^>]*>([^<]+\.(?:mp4|mov|avi|mkv|webm))<\/a>/i);
    if (!linkMatch) return match;
    const fileUrl = linkMatch[1];
    const fileName = linkMatch[2];
    const extMatch = fileName.match(/\.(\w+)$/);
    const fileType = extMatch ? extMatch[1].toLowerCase() : '';
    const sizeMatch = inner.match(/(\d+(?:\.\d+)?\s*(?:KB|MB|GB))/);
    const fileSize = sizeMatch ? sizeMatch[1] : '';
    const captionMatch = inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/);
    const caption = captionMatch ? captionMatch[1].trim() : '';
    const fileUrlSafe = escapeHtmlAttr(fileUrl);
    const captionHtml = caption ? `<div class="file-video-caption">${escapeHtmlAttr(caption)}</div>` : '';
    return `<div class="file-video"><video controls preload="metadata" width="100%"><source src="${fileUrlSafe}" type="video/${fileType}"></video><div class="file-video-info"><a href="${fileUrlSafe}" class="file-name">${escapeHtmlAttr(fileName)}</a>${fileSize ? `<span class="file-size">${fileSize} &mdash; ${fileType.toUpperCase()}</span>` : ''}<a href="${fileUrlSafe}" class="file-download" download>Download</a></div>${captionHtml}</div>`;
  });

  // Style GitBook div-based file cards (size, filename, extension, download button)
  text = replaceGitBookFileCards(text);

  // Style GitBook link cards (image logo left, title+domain right, in a rectangle)
  text = text.replace(
    /<a[^>]*class="[^"]*ring-1[^"]*ring-tint-subtle[^"]*rounded-sm[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
    (match, href, inner) => {
      const imgMatch = inner.match(/<img[^>]*src="([^"]*)"[^>]*>/);
      const imgSrc = imgMatch ? imgMatch[1] : '';
      const textBaseSpans = [...inner.matchAll(/<span[^>]*class="[^"]*text-base[^"]*"[^>]*>([\s\S]*?)<\/span>/g)];
      let title = '', domain = '';
      if (textBaseSpans.length >= 2) {
        title = textBaseSpans[0][1].trim();
        domain = textBaseSpans[1][1].trim();
      } else if (textBaseSpans.length === 1) {
        title = textBaseSpans[0][1].trim();
      }
      const safeTitle = escapeHtmlAttr(title);
      const safeDomain = escapeHtmlAttr(domain);
      const iconHtml = imgSrc ? `<span class="link-card-icon"><img src="${imgSrc}" alt="Logo"></span>` : '';
      return `<a class="link-card" href="${href}" target="_blank" rel="noopener">${iconHtml}<span class="link-card-body"><span class="link-card-title">${safeTitle}</span><span class="link-card-domain">${safeDomain}</span></span></a>`;
    }
  );

  text = replaceGitBookRoleTables(text);
  text = text.replace(/<p[^>]*>\s*<\/p>/g, '');
  text = text.replace(/<div class="sr-only">[\s\S]*?<\/div>/, '');
  text = text.replace(/^>?\s*For the complete documentation index.*?(?:llms\.txt|\.md).*?(?:\n|$)/, '');
  text = text.replace(/---\s*\n\s*#\s*Agent Instructions[\s\S]*$/, '');
  text = text.replace(/#\s*Agent Instructions[\s\S]*$/, '');

  return text;
}

function extractMarkdownFromHtml(html) {
  // Protect angle brackets inside GitBook shortcodes from cheerio's HTML parser
  // so e.g. {% embed url="<https://youtu.be/xxx>" %} doesn't get mangled.
  // Handle both literal <> and already-entity-encoded &lt; &gt; forms.
  html = html.replace(/{%[^%]*%}/g, (match) =>
    match
      .replace(/&lt;/g, '&amp;lt;')
      .replace(/&gt;/g, '&amp;gt;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  );
  const $ = require('cheerio').load(html);
  $('script, style, nav, header, footer, svg, noscript').remove();

  let content =
    $('main').html() ||
    $('[role="main"]').html() ||
    $('article').html() ||
    $('.content').html() ||
    $('.prose').html() ||
    $('#__next').html();

  if (!content) {
    const body = $('body');
    body.children().filter((i, el) => {
      const tag = (el.tagName || '').toLowerCase();
      return ['nav', 'header', 'footer', 'script', 'style', 'svg', 'noscript'].includes(tag);
    }).remove();
    content = body.html();
  }

  if (!content) return null;

  // Strip GitBook footer elements (page nav, last updated, was this helpful)
  try {
    const $c = require('cheerio').load(content);
    $c('[class*="max-w-3xl"]').each((i, el) => {
      const html = $c(el).html() || '';
      const text = $c(el).text() || '';
      if (text.includes('Was this helpful') || html.includes('Last updated')) {
        $c(el).remove();
      } else if (text.includes('Previous') || text.includes('Next')) {
        $c(el).remove();
      }
    });
    content = $c('body').html() || content;
  } catch (e) {
    // fall through if cleanup fails
  }

  return content;
}

app.get('/api/sitemap', (req, res) => {
  res.json(getSitemap());
});

function gitBookUrl(mdUrl, rendered) {
  if (!rendered) return mdUrl;
  return mdUrl.replace(/\.md$/, '');
}

app.get('/api/page', async (req, res) => {
  let { url, mode } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });
  url = String(url).trim().replace(/[:]+$/, '');

  try {
    const fetchUrl_ = url.replace(/\.md$/, '');  // strip .md to get full HTML with resolved image URLs
    const rawText = await fetchUrl(fetchUrl_);

    if (mode === 'iframe') {
      let fixedHtml = fixImageUrls(rawText, fetchUrl_);
      return res.json({
        content: fixedHtml,
        mode: 'iframe',
        url: fetchUrl_,
      });
    }

    if (mode === 'raw') {
      let rawMd = extractMarkdownFromHtml(rawText);
      if (!rawMd || rawMd.trim().length < 20) rawMd = rawText;
      rawMd = preprocessGitBookFlavoredMd(rawMd, url);
      rawMd = fixImageUrls(rawMd, url);
      return res.json({ content: rawMd, mode: 'raw', url });
    }

    let markdown = extractMarkdownFromHtml(rawText);
    if (!markdown || markdown.trim().length < 20) {
      markdown = rawText;
    }

    markdown = preprocessGitBookFlavoredMd(markdown, url);
    markdown = fixImageUrls(markdown, url);

    const html = marked.parse(markdown, { breaks: true, gfm: true });

    const headingRegex = /<h([234])[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/h\1>/gi;
    const headings = [];
    let hMatch;
    while ((hMatch = headingRegex.exec(html)) !== null) {
      const text = hMatch[3].replace(/<[^>]+>/g, '').trim();
      if (text) headings.push({ level: parseInt(hMatch[1]), id: hMatch[2], text });
    }

    res.json({ content: html, mode: 'markdown', url, headings });
  } catch (err) {
    console.error(`Failed to fetch ${url}:`, err.message);
    res.status(502).json({ error: `Failed to fetch content: ${err.message}` });
  }
});

const fileUrlCache = new Map();

app.get('/api/file/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'Missing file id' });

  const pageUrl = `${GITBOOK_BASE}/mainframe-open-education-project/files/${id}`;

  try {
    const cached = fileUrlCache.get(id);
    const actualUrl = cached || await resolveFileUrl(pageUrl);

    if (!cached && actualUrl) fileUrlCache.set(id, actualUrl);

    if (actualUrl) {
      const imgResponse = await fetch(actualUrl);
      const contentType = imgResponse.headers.get('content-type') || 'application/octet-stream';
      const buffer = await imgResponse.arrayBuffer();
      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(Buffer.from(buffer));
    }

    res.redirect(pageUrl);
  } catch (err) {
    console.error(`File proxy failed for ${id}:`, err.message);
    res.redirect(pageUrl);
  }
});

async function resolveFileUrl(pageUrl) {
  const response = await fetch(pageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MOE-Viewer/1.0)' }
  });
  const html = await response.text();

  const patterns = [
    /https?:\/\/[^"'\s>]+files\.gitbook\.io[^"'\s>]+(?:png|jpg|jpeg|gif|webp|svg)/i,
    /https?:\/\/[^"'\s>]+files\.gitbook\.io[^"'\s>]+/i,
    /"url"\s*:\s*"([^"]+files\.gitbook\.io[^"]+)"/i,
    /"src"\s*:\s*"([^"]+(?:png|jpg|jpeg|gif|webp|svg)[^"]*)"/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      let url = match[1] || match[0];
      url = url.replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
      return url;
    }
  }

  return null;
}

app.get('/api/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  try {
    const renderedUrl = gitBookUrl(url, true);
    let html = await fetchUrl(renderedUrl);
    html = fixImageUrls(html, renderedUrl);

    const $ = require('cheerio').load(html);
    $('nav, header, footer, aside, .sidebar, [class*="sidebar"], [class*="toc"], .page-no-toc, .gb-trademark, [data-testid="gb-trademark"], .theme-bold\\:text-header-link').remove();
    $('script:not([type="application/ld+json"])').remove();
    html = $.html();

    html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, (match) => {
      if (match.includes('sidebar') || match.includes('header') || match.includes('footer') || match.includes('nav')) {
        return '';
      }
      return match;
    });

    res.send(html);
  } catch (err) {
    res.status(502).json({ error: `Proxy failed: ${err.message}` });
  }
});

app.get('/api/llms', async (req, res) => {
  try {
    const text = await fetchUrl(`${GITBOOK_BASE}/mainframe-open-education-project/llms.txt`);
    const fixed = fixImageUrls(text, `${GITBOOK_BASE}/mainframe-open-education-project/`);
    res.type('text/plain').send(fixed);
  } catch (err) {
    res.status(502).json({ error: `Failed to fetch llms.txt: ${err.message}` });
  }
});

const SANDBOX_BASE_URL = config.sandboxUrl;

app.post('/api/sandbox/execute', async (req, res) => {
  const { language, code, stdin } = req.body;
  if (!language || !code) {
    return res.status(400).json({ error: 'language and code are required' });
  }
  try {
    const response = await fetch(`${SANDBOX_BASE_URL}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language, code, stdin: stdin || '' })
    });
    const result = await response.json();
    if (!response.ok) return res.status(response.status).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'sandbox execution failed', detail: err.message });
  }
});

app.get('/api/certification/status', requireAuth, async (req, res) => {
  try {
    const existing = await db.execute({
      sql: 'SELECT id, first_name, last_name, email, exam_score, status, claimed_at FROM badge_claims WHERE user_id = ? LIMIT 1',
      args: [req.session.userId],
    });
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      return res.json({
        claimed: true,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        examScore: row.exam_score,
        status: row.status,
        claimedAt: row.claimed_at,
      });
    }
    res.json({ claimed: false });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch badge status', detail: err.message });
  }
});

app.post(['/api/certification/claim', '/api/certification/issue'], requireAuth, async (req, res) => {
  const firstName = String(req.body && req.body.firstName || '').trim();
  const lastName = String(req.body && req.body.lastName || '').trim();
  const examScore = parseInt(req.body && req.body.score, 10) || 100;

  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'First name and last name are required to record your badge claim.' });
  }

  try {
    try {
      await db.execute({
        sql: 'UPDATE users SET first_name = ?, last_name = ? WHERE id = ?',
        args: [firstName, lastName, req.session.userId],
      });
    } catch (e) {}

    // Already claimed?
    const existing = await db.execute({
      sql: 'SELECT id, first_name, last_name, email, exam_score, status, claimed_at FROM badge_claims WHERE user_id = ? LIMIT 1',
      args: [req.session.userId],
    });
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      return res.json({
        alreadyClaimed: true,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        examScore: row.exam_score,
        status: row.status,
        claimedAt: row.claimed_at,
      });
    }

    // Server-side eligibility — recomputed from progress table
    const progressRes = await db.execute({
      sql: 'SELECT COUNT(DISTINCT page_url) AS completed FROM progress WHERE user_id = ?',
      args: [req.session.userId],
    });
    const completedCount = progressRes.rows[0] ? Number(progressRes.rows[0].completed) : 0;

    let totalQuizPages = 40;
    try {
      const quizzesRaw = fs.readFileSync(path.join(__dirname, 'public', 'quizzes.json'), 'utf-8');
      const quizzesObj = JSON.parse(quizzesRaw);
      totalQuizPages = Object.keys(quizzesObj).length || 40;
    } catch (e) {}

    const requiredCompletions = Math.ceil(0.8 * totalQuizPages);
    if (completedCount < requiredCompletions) {
      return res.status(403).json({
        error: `Not eligible — at least 80% of knowledge checks required (${completedCount}/${totalQuizPages} completed, minimum ${requiredCompletions} required).`
      });
    }

    const email = req.session.email;

    await db.execute({
      sql: `INSERT INTO badge_claims (user_id, first_name, last_name, email, exam_score, status)
            VALUES (?, ?, ?, ?, ?, 'pending')`,
      args: [req.session.userId, firstName, lastName, email, examScore],
    });

    console.log(`[badge] New candidate badge claim recorded: ${firstName} ${lastName} <${email}> (Score: ${examScore}%)`);

    res.json({
      alreadyClaimed: false,
      firstName,
      lastName,
      email,
      examScore,
      status: 'pending',
      claimedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[badge] claim failed:', err.message);
    res.status(500).json({ error: 'Failed to record badge claim', detail: err.message });
  }
});

app.get('/api/admin/badge-claims', async (req, res) => {
  const secret = req.query.secret || req.headers['x-admin-secret'];
  const validSecret = config.adminSecret;

  if (secret !== validSecret && (!req.session || !req.session.userId)) {
    return res.status(401).json({ error: 'Unauthorized. Provide ?secret=... or log in.' });
  }

  try {
    const out = await db.execute(`
      SELECT id, user_id, first_name, last_name, email, exam_score, status, claimed_at
      FROM badge_claims
      ORDER BY claimed_at DESC
    `);

    const format = String(req.query.format || '').toLowerCase();
    if (format === 'csv') {
      let csv = 'ID,First Name,Last Name,Email,Exam Score,Status,Claimed Date\n';
      for (const r of out.rows) {
        csv += `${r.id},"${r.first_name}","${r.last_name}","${r.email}","${r.exam_score}%","${r.status}","${r.claimed_at}"\n`;
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="moe_badge_candidates.csv"');
      return res.send(csv);
    }

    res.json({
      total: out.rows.length,
      claims: out.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch badge claims', detail: err.message });
  }
});

app.get('/certification', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'certification.html'));
});

const configProblems = productionConfigProblems();
if (configProblems.length > 0) {
  console.error('[config] Refusing to start with an unsafe production configuration:');
  for (const problem of configProblems) console.error(`  - ${problem}`);
  process.exit(1);
}
if (!config.isProduction) {
  const devWarnings = [];
  if (config.sessionSecret === 'moe-dev-insecure-secret-change-me') devWarnings.push('SESSION_SECRET');
  if (config.adminSecret === 'moe-dev-insecure-secret-change-me') devWarnings.push('ADMIN_SECRET');
  if (devWarnings.length > 0) {
    console.warn(`[config] Development mode: using insecure defaults for ${devWarnings.join(', ')}. Never use in production.`);
  }
}

let httpServer = null;
let shutdownStarted = false;

async function shutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.log(`[shutdown] ${signal} received, draining connections...`);

  const forceExit = setTimeout(() => {
    console.error('[shutdown] Timed out waiting for connections to drain, forcing exit.');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  try {
    if (httpServer) await new Promise(resolve => httpServer.close(resolve));
    stopSitemapRefreshLoop();
    await db.close();
    console.log('[shutdown] Clean exit.');
    process.exit(0);
  } catch (err) {
    console.error('[shutdown] Error during shutdown:', err.message);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

Promise.all([initUserSchema(), startSitemapRefreshLoop()])
  .then(() => {
    httpServer = app.listen(PORT, () => {
      console.log(`MOE GitBook Viewer running at http://localhost:${PORT} (${config.env}, db: ${db.isPostgres ? 'postgres' : 'sqlite/libsql'})`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize server dependencies:', err);
    process.exit(1);
  });
