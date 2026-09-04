# Mainframe Open Education (MOE) — Project Analysis

This document is a complete technical analysis of the **Mainframe_Open_Education** repository. It is written for other LLMs / developers so the project's structure, data flow, and conventions can be understood without re-reading every file.

---

## 1. What This Project Is

An **interactive web application** that re-presents the **Mainframe Open Education (MOE)** curriculum — originally published as a GitBook at `https://open-mainframe-project.gitbook.io/mainframe-open-education-project` — as a custom learning platform. It is NOT a static copy of the content: it **proxies, fetches, and scrapes the live GitBook** at request time, then transforms GitBook-flavored HTML/Markdown into clean content for its own UI.

Primary features:
- **GitBook content viewer** (`public/viewer.html`, `public/js/app.js`) — fetches pages from GitBook, converts them to Markdown or HTML, renders them with a custom GitBook-style UI (sidebar, TOC, reading time, breadcrumbs, prev/next, and font sizing).
- **Dual progress completion system**:
  - **Knowledge-check quizzes** — 40 pages ship with quizzes (131 total questions) stored in `public/quizzes.json`. Submitting a quiz marks that page completed.
  - **Scroll & read-time dwell completion** — pages without quizzes are automatically completed via an `IntersectionObserver` observing an end-of-page sentinel, with a dynamic read-time dwell fallback (5–60 s based on word count).
- **Sequential chapter locking & prerequisites** — chapters in the sidebar enforce sequential progression. Incomplete preceding chapters lock future chapters, displaying lock icons.
- **Dynamic Welcome & Resume dashboard** — the welcome screen computes total curriculum progress, displays completed vs. remaining lessons, and offers quickstart "Continue Learning" (jumping to the first unfinished lesson) and "Start from the Beginning" actions.
- **Email + password accounts & cross-device sync** (`public/js/auth.js`, `server.js`) — optional self-hosted auth using SQLite/libSQL and bcrypt. **Logged out**, progress lives only in `localStorage`; **logged in**, it is merged with and persisted on the server so it follows the account across devices.
- **Landing page progress bars** (`public/index.html`, `public/css/landing.css`) — curriculum cards on the marketing home page render live per-chapter completion derived from the same progress store.
- **MOE Practitioner Badge** (`public/certification.html`) — a 20-question randomized exam (pass = ≥80%) gated behind completing ≥80% of the knowledge-check quizzes (32 of 40 quiz pages); passing shows a message that the badge is issued by the Linux Foundation via Credly.
- **In-browser COBOL sandbox**:
  - **Global sandbox** — header button opens a persistent editor to write/run COBOL from any page.
  - **Inline sandbox** — auto-injected onto pages whose text mentions "cobol".
  - Code is executed by an **external GnuCOBOL sandbox service** proxied by this server.
- **Command palette & keyboard navigation** — `⌘K` / `Ctrl+K` instant search modal across all sitemap pages, plus custom column scrolling keys (`Space`, `PageUp`, `PageDown`, `Home`, `End`).

Sponsorship: content is from the **Open Mainframe Project (OMP)**, a Linux Foundation project. UI uses their navy `#2F5FD6` / brass `#C9A65A` branding, and IBM Plex fonts.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Backend runtime | Node.js (CommonJS, no build step, Node 20+) |
| Backend framework | Express 4 (`express` v4.18.2) |
| Sessions | `express-session` (v1.19.0, cookie-based, in-memory store) |
| Password hashing | `bcryptjs` (v3.0.3, 12 rounds, pure JS) |
| Database | SQLite via `@libsql/client` (v0.17.4) — local `file:data/moe.db` in dev, hosted Turso/libSQL in prod |
| Markdown | `marked` (v18.0.5) |
| HTML parsing / DOM | `cheerio` (v1.0.0) |
| Sandbox proxying | Node global `fetch` to external GnuCOBOL sandbox microservice |
| Frontend | Vanilla JS (no framework), plain CSS, inline SVG, Web APIs (`IntersectionObserver`, `localStorage`, `CustomEvent`) |
| Data files | `sitemap.md` (static), `public/quizzes.json` (generated, 40 quizzes / 131 questions), `data/moe.db` (runtime DB) |
| Deployment | Dockerfile (`node:20-slim`) + Render blueprint (`.render.yaml`); also deployable to Railway |
| Dev deps | None extra; `npm install` is enough |

**Key fact:** There are no tests, no linter config, no TypeScript, and no bundler. `npm start` / `npm run dev` both just run `node server.js`.

---

## 3. Directory / File Structure

```
Mainframe_Open_Education/
├── server.js                     # Express backend + routing + auth + Credly badge issuance (1,017 lines)
├── credly-badges.js              # Real Credly badge issuance integration module (101 lines)
├── sitemap-parser.js             # Shared sitemap parser for indented and unindented trees (52 lines)
├── sitemap-cache.js              # Live auto-refreshing sitemap cache with 1h interval & fallback (138 lines)
├── build-quizzes.js              # Offline CLI tool: generates quizzes.json via Claude API (224 lines)
├── quiz-prompt-template.txt      # System prompt used by build-quizzes.js (50 lines)
├── sitemap.md                    # Static cold-boot fallback table-of-contents of the GitBook (116 lines)
├── package.json                  # deps: express, cheerio, marked, ssh2 (unused), @libsql/client, bcryptjs, express-session
├── package-lock.json             # NPM lockfile
├── Dockerfile                    # node:20-slim, no system chromium (14 lines)
├── .dockerignore                 # excludes node_modules/, data/, .git from the image build
├── .render.yaml                  # Render blueprint (docker web service, env vars incl. SESSION_SECRET + Turso)
├── .gitignore                    # node_modules, .DS_Store, *.full, piston-sandbox/, data/, typescript, MOE-WebPage.jpg
├── LICENSE                       # Apache 2.0 License
├── MOE-WebPage.jpg               # UI screenshot / preview asset (gitignored)
├── typescript                    # Terminal session log artifact (gitignored)
├── logo/                         # Brand & decorative assets (moebook.png, moebook.avif, moe-logo-black.png, element1-8.png, "moe log.png")
├── data/                         # Runtime SQLite DB (gitignored) — moe.db created on first start
└── public/
    ├── index.html                # Marketing landing page (hero, brand showcase, journeys, curriculum w/ live progress bars, 1,006 lines)
    ├── viewer.html               # Main SPA shell (header, sidebar, content, TOC, command palette, auth modal, 174 lines)
    ├── certification.html        # Badge exam page + interactive Credly claim flow (784 lines)
    ├── quizzes.json              # Generated quiz data keyed by page URL (40 quizzes, 131 questions, 1,828 lines)
    ├── css/style.css             # Reader/certification styles (~2,996 lines)
    ├── css/landing.css           # Landing page styles (~1,889 lines)
    ├── js/auth.js                # Shared account system: auth state, progress sync, login/register modal UI (256 lines)
    └── js/app.js                 # Viewer logic (~1,566 lines, vanilla JS)
```

### `ssh2` dependency — unused
`ssh2` is listed in `package.json` but **never imported anywhere**. It is a leftover. Safe to remove if desired.

---

## 4. Backend (`server.js`) — Detailed Breakdown

### 4.1 Constants & Setup
- `PORT = process.env.PORT || 3000`
- Static mounts: `public/` at `/`, and `logo/` at `/logo`.
- `GITBOOK_BASE = 'https://open-mainframe-project.gitbook.io'`
- `FETCH_TIMEOUT = 15000` (15 s abort timeout for all outbound fetches).

**Account system wiring (top of file, before route handlers):**
- `SESSION_SECRET` (env, dev fallback) signed into an `express-session` cookie: `httpOnly`, `sameSite: 'lax'`, `secure: NODE_ENV === 'production'`, 30-day max age. `app.set('trust proxy', 1)` in production so secure cookies work behind Render's HTTPS proxy.
- **Database client:** `createClient({ url, authToken })` from `@libsql/client`. `url` defaults to `file:<__dirname>/data/moe.db` (dev) or `process.env.TURSO_DATABASE_URL` (prod). For `file:` URLs the parent `data/` directory is created first via `fs.mkdirSync`.
- **Schema** created idempotently at boot by `initUserSchema()`:
  ```sql
  users(id INTEGER PK AUTOINCREMENT, email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL, first_name TEXT, last_name TEXT,
        created_at TEXT DEFAULT datetime('now'))
  progress(user_id INTEGER NOT NULL, page_url TEXT NOT NULL,
           completed_at TEXT DEFAULT datetime('now'),
           PRIMARY KEY (user_id, page_url))
  badges(user_id INTEGER NOT NULL, credly_badge_id TEXT,
         badge_template_id TEXT NOT NULL,
         issued_at TEXT DEFAULT datetime('now'),
         PRIMARY KEY (user_id, badge_template_id))
  ```
- **`requireAuth(req,res,next)`** — 401 unless `req.session.userId` is set.
- **`rateLimitAuth(key)`** — in-memory brute-force guard: ≤10 attempts per IP/email per 15 min window for the auth POST routes.
- **`insertProgressBatch(userId, pages)`** — upserts many page URLs (uses `INSERT OR IGNORE`).
- Startup is async: `Promise.all([initUserSchema(), startSitemapRefreshLoop()]).then(() => app.listen(...))`.

### 4.2 Helpers (pure functions, ordered as in file)

**`fetchUrl(url)`** — fetches text with a 15 s abort timeout and a custom `User-Agent: Mozilla/5.0 (compatible; MOE-Viewer/1.0)`. Throws `Request timed out` on AbortError.

**`fixImageUrls(text, baseUrl)`** — rewrites relative URLs found inside GitBook content. Applies to markdown link syntax `( /path )`, `src="..."`, and `href="..."`:
- `files/<id>` → rewritten to local proxy route `/api/file/<id>`.
- `~gitbook/...` → prefixed with `GITBOOK_BASE`.
- Paths like `pages/...` or `[a-zA-Z0-9_-]+/...` → prefixed with `GITBOOK_BASE`.
- Otherwise (for src/href) → prefixed with a computed `base` (the page's directory path).
- `api/...` paths are left untouched (pass-through).

**`normalizeEmbedUrl(url)`** — strips wrapping `< >`, quotes, and decodes HTML entities (`&lt;` → `<`, `&gt;`, `&amp;`, `&quot;`).

**`escapeHtmlAttr(text)`** — escapes `& < > "` for safe HTML attribute insertion.

**`getYouTubeEmbedUrl(url)`** — converts `youtu.be/ID`, `youtube.com/watch?v=ID`, and `youtube.com/<path>` into `https://www.youtube.com/embed/<videoId>`. Returns `null` if it isn't a recognized YouTube URL.

**`renderEmbedBlock(url, label)`** — renders a GitBook `{% embed %}` block:
- Image URLs (png/jpg/jpeg/gif/webp/svg) → `<figure class="embed embed-image">`.
- YouTube → `<div class="embed embed-video"><iframe ...>`.
- Anything else → `<div class="embed embed-link">` with truncated URL + optional label.

**`replaceGitBookRoleTables(text)`** — finds GitBook's `<div role="table">` markup and converts it to semantic `<table>`. Uses a depth-counting `findMatchingDiv` to capture nested `<div>` trees, extracts `role="columnheader"`, `role="row"`, `role="cell"` blocks, strips inner tags via `cleanCell`, and emits `<div class="table-wrapper"><table>`.

**`replaceGitBookFileCards(text)`** — finds GitBook file-download cards (matched by a `decoration-primary/6` class, a file size like `12 KB`, and a link ending in a file extension). Replaces them with either:
- `<div class="file-video"><video>` for video extensions, or
- `<div class="file-card">` (📄 icon + filename + size + Download link) otherwise.

**`simplifyGitBookLists(text)`** — converts GitBook's complex flexbox `<ul>/<ol>` markup into plain `<ul>/<ol><li>` lists by extracting the `flex min-w-0 flex-1` inner div of each `<li>`.

**`preprocessGitBookFlavoredMd(raw, pageUrl)`** — the biggest transform. It takes raw GitBook HTML/Markdown and normalizes it before `marked` parses it. Order of operations:
1. Decode HTML entities (`&amp;` first so `&amp;lt;` → `&lt;`).
2. `simplifyGitBookLists`.
3. Handle `{% file src="..." %}...{% endfile %}` and self-closing `{% file %}` → `file-card`/`file-video` divs pointing at `/api/file/<id>`.
4. Handle `{% stepper %}...{% endstepper %}` with `{% step %}...{% endstep %}` → numbered markdown list.
5. Handle `{% embed url="..." %}...{% endembed %}` and self-closing embeds → `renderEmbedBlock`.
6. Handle `{% hint style="..." %}...{% endhint %}` → markdown blockquote with a symbol (⚠️ for danger/warning, ℹ️ for info, ✅ for success).
7. Handle `{% columns %}` with `{% column width="..." %}` → joined as paragraph blocks.
8. Rewrite `<table>...</table>` — strips disallowed tags (keeps only `a, strong, b, em, i, code, span`), turns first row into `<thead>` if it has `<th>`, wraps in `.table-wrapper`.
9. Normalize `<figure>` blocks — pulls out `<img>` + optional `<figcaption>`, adds inline styling.
10. Strip `<mark>` highlight tags.
11. Convert `&#x20;` to spaces.
12. Convert GitBook `<picture class="decoration-primary/6">` video cards into `file-video` embeds.
13. `replaceGitBookFileCards` (div-based cards).
14. Rewrite GitBook **link cards** (anchors with `ring-1 ring-tint-subtle rounded-sm` classes) into `.link-card` markup with icon + title + domain.
15. `replaceGitBookRoleTables`.
16. Remove empty `<p>`, `sr-only` divs, the "For the complete documentation index" line, and everything after `# Agent Instructions`.

**`extractMarkdownFromHtml(html)`** — loads HTML with cheerio; first protects GitBook shortcodes from being mangled (encodes angle brackets inside `{% ... %}`), removes `script/style/nav/header/footer/svg/noscript`, then extracts the main content from (in priority order): `main`, `[role="main"]`, `article`, `.content`, `.prose`, `#__next`, or falls back to cleaned `<body>`. Finally strips GitBook footer widgets ("Was this helpful", "Last updated", "Previous/Next").

**`parseSitemap(markdown)`** (`sitemap-parser.js`) — parses markdown sitemaps into a nested tree. Supports both 2-space indented Markdown (`sitemap.md`) and unindented Markdown with URL path hierarchy (`llms.txt`). Returns `[{ title, url, children: [] }]`.

### 4.3 API Endpoints

| Method & Path | Purpose |
|---|---|
| `GET /api/sitemap` | Returns the live, auto-refreshing sitemap cache: `{ tree: [...], lastRefreshedAt: string, stale: boolean }`. Refreshed live every 1 hour with `sitemap.md` cold-boot fallback. |
| `GET /api/page?url=<gitbook-url>[&mode=raw\|iframe]` | Core content endpoint. Fetches the live GitBook page. Three modes: |
| | **default** → returns `{ content: HTML (via marked), mode: 'markdown', url, headings: [{level, id, text}] }` (headings extracted from h2/h3/h4). |
| | `raw` → returns `{ content: preprocessed Markdown, mode: 'raw', url }`. |
| | `iframe` → returns the **raw GitBook HTML** with image URLs fixed (`{ content, mode: 'iframe', url }`). |
| `GET /api/file/:id` | **File proxy.** Resolves a GitBook `files/<id>` page to a real `files.gitbook.io` asset URL (regex-scraped from the page HTML), caches the mapping in memory, then streams the file with a 1-day cache header. Falls back to a redirect if resolution fails. |
| `GET /api/proxy?url=` | Iframe-style proxy of a GitBook page; strips nav/sidebar/footer/scripts and sidebar-related `<style>` blocks, serves clean-ish HTML for embedding. (Not used by the current frontend — legacy.) |
| `GET /api/llms` | Fetches `.../llms.txt` from GitBook and returns it as `text/plain` after fixing image URLs. |
| `POST /api/sandbox/execute` | Forwards `{ language, code, stdin }` to `SANDBOX_URL` (`process.env.SANDBOX_URL \|\| 'https://mainframe-sandbox.onrender.com'`) at `/execute`, relays the JSON result. Returns 400 if `language`/`code` missing, 500 on network failure. |
| `GET /certification` | Serves `public/certification.html` — the MOE Practitioner Badge exam. |
| `POST /api/auth/register` | `{ email, password }` → validates (email format, password ≥6 chars), 409 on duplicate, hashes with `bcrypt.hash(pw, 12)`, inserts, sets `req.session.userId/email`. Rate-limited. |
| `POST /api/auth/login` | `{ email, password }` → `bcrypt.compare`; 401 on mismatch, sets session on success. Rate-limited. |
| `POST /api/auth/logout` | Destroys the session and clears the `connect.sid` cookie. |
| `GET /api/auth/me` | `{ user: { id, email } }` when a session exists, else `{ user: null }`. |
| `GET /api/progress` | *(auth)* Returns `{ pages: [...] }` — the user's completed page URLs. |
| `POST /api/progress` | *(auth)* Body `{ pageUrl }` → `INSERT OR IGNORE` one completion. |
| `POST /api/progress/sync` | *(auth)* Body `{ pages: [...] }` → replaces the user's full progress set (delete + re-insert). Used for merge-on-login. |
| `GET /api/certification/status` | *(auth)* Returns `{ claimed: boolean, firstName, lastName, email, examScore, status, claimedAt }` for the authenticated user. |
| `POST /api/certification/claim` (alias `/api/certification/issue`) | *(auth)* Body `{ firstName, lastName, score }` → server-side verifies ≥80% progress (≥32/40), records candidate details in `badge_claims` table, updates `users` name, and returns claim confirmation. |
| `GET /api/admin/badge-claims` | *(admin / auth)* Query `?secret=...` (or auth session), optional `?format=csv` → returns all badge candidates (Name, Email, Score, Date, Status) as JSON or downloadable CSV to email to the Linux Foundation. |

### 4.4 Linux Foundation Credly Badge Claims & Admin Export

When candidates complete ≥80% of curriculum quizzes and pass the 20-question certification exam, their details are recorded in the `badge_claims` database table. The developer/admin can export this data to email to the Linux Foundation team:

1. **Download as CSV (ready to attach directly to your email):**
   ```
   GET https://<your-render-url>/api/admin/badge-claims?format=csv&secret=<SESSION_SECRET>
   ```
   Exports a clean spreadsheet with columns: `ID, First Name, Last Name, Email, Exam Score, Status, Claimed Date`.

2. **View as JSON:**
   ```
   GET https://<your-render-url>/api/admin/badge-claims?secret=<SESSION_SECRET>
   ```

---

## 5. Frontend

### 5.1 `public/viewer.html` — App Shell (172 lines)

DOM layers, in order:
1. **`#top-header`** — sidebar toggle (`#sidebar-toggle`) + logo link to `/`, center search input (`#search-input` with `⌘K` hint), right cluster: progress label + bar (`#progress-fill`), **Sandbox** toggle button, dark-mode toggle (`#dark-toggle`), and `#auth-container` (the login/account button).
2. **`#app`** — three-column layout:
   - `#sidebar` → "Your Journey" progress indicator (`#sp-pct`, `#sidebar-progress-fill`, `#sp-count`), followed by `#nav-tree` (collapsible chapter accordion modules with lock badges and checkmarks).
   - `#content-area` → floating background elements (`.content-floats`), toolbar (breadcrumb + dynamic read-time estimate `#read-time` + view-mode buttons), a hidden `#sandbox-container` (COBOL textarea + Run + stdout/stderr terminal), and `#page-content` (renders interactive welcome dashboard / documentation / quizzes).
   - `#toc-sidebar` → `#page-toc` ("On this page" headings with active scroll tracking).
3. **`#cmd-palette`** — command palette modal (`⌘K` / `Ctrl+K`) for fuzzy searching across all documentation pages.
4. **`#auth-modal`** — login/Sign Up tabs, email + password fields, error line, and a "saved locally" note. Loads `js/auth.js` before `js/app.js`.

### 5.2 `public/js/app.js` — Viewer & SPA Logic (~1,560 lines)

Global state: `sitemapData`, `currentUrl`, `currentTitle`, `currentMode` (`auto`/`raw`/`sandbox`/`iframe`), `quizzesData`, `chapterModules`, `welcomeHtml`.

**Sitemap & Chapter Accordion Hierarchy**
- `fetchSitemap()` → `/api/sitemap`.
- `buildChapterSidebar(nodes, container)` — splits sitemap into **6 Core Journey Chapters** (which count toward progress) and **"More" Resource Sections** (`MORE_SECTION_TITLES = ['Additional Mainframe Resources', 'Backlog on Topics', 'Mainframe 101 - Blog Series']`).
- `buildChapterModule(mod, index)` — builds numbered chapter accordion modules (00 through 05) with chapter title, lesson count, estimated duration (`formatDuration(minutes)` based on 15 min/lesson), difficulty badge (`CHAPTER_DIFFICULTY`), and mini progress bar.
- `buildLessonItem(item)` — creates `.lesson-step` items with status badge spans.
- `findNodeByUrl`, `flattenSitemap`, `setActiveNavItem` — tree traversal + active state highlighting.
- `renderPageNav(url)` — previous/next links derived from the flattened sitemap order.
- `updateBreadcrumb(url)` — path of titles from root to current page via `findPathToNode`.

**Sequential Chapter Locking & Prerequisites**
- `updateSidebarCheckmarks()` — computes completion percentage for each chapter. If a chapter's predecessor is incomplete, subsequent chapters receive `.locked` class and render the SVG lock icon (`LOCK_ICON`), preventing premature skipping.

**Dual Progress Completion Engine**
- `getCompletedQuizzes()` / `isQuizCompleted(url)` — reads `moe_completed_quizzes` from `localStorage`.
- `markPageCompleted(url)` — writes to `localStorage`, calls `window.MOE_AUTH.report(url)` for server sync if logged in, updates sidebar checkmarks, and refreshes the progress bar.
- **Quiz Completion:** `renderQuiz(url)`, `gradeQuiz()`, `retakeQuiz()` — renders single/multi choice questions from `quizzes.json`. Submitting grades the quiz and marks the page complete.
- **Scroll & Read-Time Dwell Completion:** `setupScrollCompletion(url)`, `clearScrollCompletion()` — for pages without a quiz, appends a `.page-end-sentinel` observed by an `IntersectionObserver`. Crossing the sentinel (reaching page end) marks the page complete. Includes a dynamic dwell timer fallback (`dwellMs` between 5 s and 60 s based on word count).
- `getProgress()` / `updateProgressUI()` — computes total vs completed lessons across core journey chapters (`NON_PROGRESS_TITLES` excluded from denominator) and updates `#progress-text` and `#progress-fill`.

**Dynamic Welcome Screen & Resume Dashboard**
- `showWelcome(title)` — restores the welcome dashboard with overall journey completion %, lesson count, and knowledge checks passed count.
- `renderRemainingLessons()` — dynamically computes all incomplete journey lessons and displays an interactive "Lessons still to complete" list with links and "Quiz: submit to confirm" tags.
- Quickstart buttons: "Continue Learning" jumps to `getFirstIncompleteLesson()`; "Start from the Beginning" jumps to `getFirstLesson()`.

**Content Rendering & Enhancements**
- `loadPage(node)` — hides sandbox, shows skeleton loader (`showSkeleton`), calls `fetchPageContent(node.url, mode)`, injects `<h1>title</h1>` + rendered HTML, and runs post-render enhancers.
- `calculateReadTime(text, wpm)` / `updateReadTime()` — clones content, strips code blocks, computes reading time in minutes, and updates `#read-time`.
- `renderPageToc(headings)` / `setupTocScrollTracking()` — right-side TOC with `IntersectionObserver` scroll tracking.
- `addPageMeta(url)` — inserts `✓ Quiz passed` or `✓ Completed` badge under the main `<h1>`.
- `addCopyButtons()` — wraps `<pre>` blocks in `.code-wrapper` with a Copy button.
- `setupImageLightbox()` — full-screen zoomable lightbox for documentation images.
- `addFeedbackWidget()` — appends "Was this helpful?" voting buttons at the bottom of each page.
- `addEditLink(url)` — generates a direct GitHub link to suggest changes.
- `setupPrefetch()` — `IntersectionObserver` injecting `<link rel="prefetch">` tags for links entering near the viewport.

**COBOL Sandbox Integration**
- **Global Sandbox:** `#sandbox-container` with editor textarea, language selector, Run button (`runSandboxCode`), and stdout/stderr output terminal.
- **Inline Sandbox (`addInlineSandbox`):** auto-injected onto any page containing "cobol" (`hasCobolContent`).
- Keybindings: `Ctrl/Cmd+Enter` to run; `Tab` inserts two spaces.

**Search, Command Palette & Keyboard Controls**
- Header search (`performSearch`) — filters visible sidebar items.
- Command palette (`openCommandPalette`, `filterCommandPalette`) — `⌘K` / `Ctrl+K` modal with arrow navigation.
- URL parameters: `?goto=<url>` deep-links directly to a page; `?q=<term>` populates search and filters the sidebar.
- Page column keyboard scrolling: `Space`, `PageDown`, `PageUp`, `Home`, `End` scroll `#content-area` smoothly.
- `init()` — bootstraps on `DOMContentLoaded`, awaits `MOE_AUTH.init()`, renders the account button, and merges progress.

### 5.3 `public/js/auth.js` — Shared Account System (256 lines)

A single IIFE exposing `window.MOE_AUTH`, shared across `viewer.html`, `certification.html`, and `index.html`:
- `MOE_AUTH.init()` — `GET /api/auth/me`; sets `MOE_AUTH.user` or `null`.
- `MOE_AUTH.isLoggedIn()` — true when a user is authenticated.
- `MOE_AUTH.mergeProgress()` — unions server progress with local `moe_completed_quizzes`, writes back to `localStorage`, and POSTs via `/api/progress/sync`. Runs on login and page load.
- `MOE_AUTH.report(pageUrl)` — updates `localStorage` and, if logged in, POSTs to `/api/progress`.
- `MOE_AUTH.register/login/logout` — calls backend auth endpoints and updates session state.
- **UI helpers:** `renderAccountButton(containerId)`, `openModal/closeModal/switchTab`, and `bindModalEvents()`. Emits `moe:auth-ready` and `moe:auth-changed` custom events.
- **Logged-out behavior is unchanged**: progress remains purely in `localStorage`.

### 5.4 `public/css/style.css` (~2,946 lines)
Comprehensive design system using CSS custom properties (`--primary`, `--navy`, `--gold`, `--bg`, `--text`, etc.). `.dark` class on `<html>` toggles dark theme. Styles cover header, sidebar accordion, lock indicators, content typography, code blocks, tables, embeds, video players, quizzes, sandbox, command palette, lightbox, skeletons, page-nav, TOC, feedback, certificate, and account modal UI.

### 5.5 `public/certification.html` — MOE Practitioner Badge Exam (784 lines)
Standalone exam application sharing `style.css` and `auth.js`.
- **Auth-aware init:** awaits `MOE_AUTH.init()` and merges progress before checking eligibility.
- **Gate:** ≥80% of quiz pages must be completed (32 of 40); otherwise renders a circular progress ring, completion percentage, and a dynamic list of incomplete quiz links (`/?goto=<url>`).
- **Exam Pool:** randomly selects **20 questions** (shuffled) from the global pool of 131 questions across all 40 quiz pages.
- **Grading & Credly Claim Flow:** exact-match grading; **pass = ≥80% (16/20)**. On pass:
  - If unauthenticated, prompts user to log in or create an account to record achievement.
  - If authenticated, queries `/api/certification/status`. If unissued, renders the name claim form (first/last name) and submits to `POST /api/certification/issue`.
  - On issuance, renders the official digital badge confirmation card with a prominent "Accept Your Badge on Credly ↗" button linking directly to Credly claim URL.
  - If failed, provides score breakdown and a Retake Exam button.

### 5.6 `public/index.html` & `public/css/landing.css` — Marketing Landing Page (1,005 lines / 1,889 lines CSS)
Interactive marketing page with hero, learning journeys, curriculum carousel, community, live events, success stories, certifications, and resources sections.
- Header `#auth-container` renders the shared login/account button.
- **Hero section:** animated floating badges and magnetic hover stats (`.l-hero-stat`) tracking cursor movement.
- **Search:** `#l-search-input` with `/` shortcut, navigating to `/viewer.html?q=...`.
- **5 Guided Learning Journeys:** cards deep-linking to viewer topics with `?goto=`.
- **Curriculum Carousel:** horizontal scrollable cards (6 chapters) with drag-to-scroll, arrow navigation, and live progress bars per chapter (`updateLandingProgress()`).
- **Interactive Experience preview:** mock reader window with code snippet and quiz preview.
- **Mobile navigation:** hamburger drawer with smooth animations.
- **Live curriculum progress:** an inline `updateLandingProgress()` fetches `/api/sitemap`, reads `moe_completed_quizzes`, maps each `.l-cur-card` to its chapter via the `?goto=` URL, counts completed vs total lesson URLs, sets the `.l-cur-progress-fill` width, and injects a "N% complete" label. Runs on load, on `pageshow` (returning from the viewer), and on `moe:auth-changed`.
- **Footer:** links to GitHub, GitBook, Slack, and Linux Foundation legal pages.

---

## 6. The Quiz Generation Pipeline (offline CLI)

**`build-quizzes.js`** is a manual, one-shot Node script (not part of the runtime app):
1. Requires `ANTHROPIC_API_KEY`.
2. Requires the dev server running on `localhost:3000` (checks `/api/sitemap` first).
3. Iterates a hardcoded `flaggedPages` list (**74 GitBook page URLs** across all chapters — see lines 9–74 of the file).
4. For each page: fetches raw markdown via `GET /api/page?url=...&mode=raw`, sends it to the **Anthropic Messages API** (`claude-sonnet-4-20250514`, 2000 max tokens) using the prompt in `quiz-prompt-template.txt`.
5. Parses the returned JSON (strips code fences), displays the quiz in the terminal, and asks `Accept this quiz? [Y/n/r (retry)]`.
6. Accepted quizzes accumulate into `quizzes[url] = quizData`; writes `public/quizzes.json`.

**`quiz-prompt-template.txt`** instructs the model to produce 3–6 questions, each `single` or `multi`, with 3–5 plausible options, ids `q1..`, and `answer` as an int (single) or int array (multi). Output must be pure JSON matching the exact schema.

**Schema of `public/quizzes.json`:**
```json
{
  "<page-url>": {
    "questions": [
      { "id": "q1", "type": "single|multi", "prompt": "...", "options": ["..."], "answer": 0 | [0,2] }
    ]
  }
}
```

> **Note:** The generated `public/quizzes.json` currently contains **40 quizzes** with **131 questions** (107 single choice, 24 multiple choice).

---

## 7. Data Flow Summaries

### Rendering a documentation page
```
Browser (app.js loadPage)
  └─ GET /api/page?url=<gitbook page>.md
       └─ server.js: fetchUrl(GitBook page without .md)
            └─ extractMarkdownFromHtml(html)      // cheerio: pull main content
            └─ preprocessGitBookFlavoredMd(...)   // normalize GitBook shortcodes/tables/cards
            └─ fixImageUrls(...)                  // rewrite relative URLs
            └─ marked.parse(...)                  // Markdown → HTML
            └─ extract headings (h2-h4) → JSON response
  └─ inject <h1> + HTML into #page-content
  └─ attach Quiz (if in quizzes.json) OR setup Scroll Sentinel + Dwell Timer
  └─ renderPageToc / updateReadTime / addInlineSandbox / page-nav / copy buttons / lightbox / breadcrumb
```

### Dual progress completion flow
```
Document Page Loaded:
  ├─ Has Quiz in quizzes.json:
  │    └─ User answers & submits Knowledge Check
  │    └─ gradeQuiz() evaluates answers
  │    └─ markPageCompleted(url)
  │
  └─ No Quiz (Informational Guide):
       └─ IntersectionObserver watches bottom-of-page .page-end-sentinel
       └─ Sentinel reaches viewport OR read-time dwell fallback timer triggers (5-60s)
       └─ markPageCompleted(url)
```

### Running COBOL
```
Browser → POST /api/sandbox/execute {language:'cobol', code}
  → server.js → fetch(`${SANDBOX_URL}/execute`)   // external GnuCOBOL sandbox microservice
  → JSON { compile: {...}, run: { stdout, stderr, signal } } → relayed back
```

### Syncing progress with an account
```
Login / register (viewer | certification | landing)
  → /api/auth/me (session cookie)        // MOE_AUTH.init()
  → /api/progress                        // server's completed pages
  → union(serverPages, localStorage moe_completed_quizzes)
  → write merged set to localStorage
  → POST /api/progress/sync { pages }    // server adopts the merged set
Then, each completion (app.js markPageCompleted):
  → localStorage update (always)
  → POST /api/progress { pageUrl } when logged in (fire-and-forget)
Logged out: no server calls — localStorage only (original behavior preserved).
```

### Earning the MOE Practitioner Badge
```
Complete ≥80% of quiz pages (32 of 40 in localStorage: moe_completed_quizzes)
  → GET /certification → eligibility check (≥80% progress required)
  → 20 random questions picked from 131-question pool → pass = ≥80% (16/20)
  → Pass message: badge will be issued by the Linux Foundation via Credly
  → Fail: message + Retake button (no name form, no PDF)
```

---

## 8. Deployment & Configuration

- **Local:** `npm install && npm start` → `http://localhost:3000`. Uses a local SQLite file `data/moe.db` (auto-created, gitignored). No external services required.
- **Dockerfile:** slim `node:20-slim` (no system Chromium), `npm install --omit=dev`, `EXPOSE 3000`, `CMD ["node", "server.js"]`. No build tools needed for the pure-JS `@libsql/client`.
- **`.dockerignore`:** excludes `node_modules/`, `data/`, `.git/` — critical so the host's macOS `node_modules` never overwrites the Linux container build, and so the local DB isn't baked into the image.
- **Render blueprint (`.render.yaml`):** single web service `moe-viewer`, docker, free plan. Env vars: `NODE_ENV=production`, `SANDBOX_URL` (`https://mainframe-sandbox.onrender.com`), plus `SESSION_SECRET`, `TURSO_DATABASE_URL`, and `TURSO_AUTH_TOKEN` (all `sync: false`, set in the dashboard).
- **Env vars read by the app:**
  - `PORT` (default 3000)
  - `SANDBOX_URL` (default `https://mainframe-sandbox.onrender.com`)
  - `SESSION_SECRET` (required in prod; dev has an insecure fallback)
  - `TURSO_DATABASE_URL` (hosted libSQL URL; falls back to local `data/moe.db`)
  - `TURSO_AUTH_TOKEN` (needed when `TURSO_DATABASE_URL` is set)
  - `ANTHROPIC_API_KEY` (only for the offline quiz builder)
- **Externally required services:** the live GitBook (content source), the COBOL sandbox service (`piston-sandbox/`, gitignored; migrated from the Piston API `emkc.org` to a local GnuCOBOL backend), and — for durable production accounts — a **hosted Turso database** (the Render free tier's filesystem is ephemeral, so a bare SQLite file there would be wiped on redeploy).

---

## 9. Noteworthy Architecture Decisions / Quirks

1. **No content is stored locally.** Every page render is a live fetch from GitBook with a 15 s timeout. If GitBook is down, the whole app renders errors (502). `sitemap.md` is the only locally-stored content metadata.
2. **Content is transformed twice.** GitBook's served HTML is scraped down to HTML fragments (cheerio), then that fragment (which is "GitBook-flavored") is processed by regex-heavy `preprocessGitBookFlavoredMd` before `marked` renders it. This is fragile but works for the current GitBook DOM.
3. **The API mode parameter is passed from the client**, and the client `currentMode` is only ever `auto`/`raw`/`sandbox` in practice; `iframe` mode exists server-side but has no UI button (the toolbar currently only has a "Sandbox" button).
4. **Dual progress tracking mechanisms:** Progress %, sidebar checkmarks, and badge-exam eligibility derive from the localStorage list `moe_completed_quizzes`. Quiz pages complete on quiz submission; non-quiz pages complete via bottom-of-page scroll sentinel and dwell time. When logged in, completions are synced with SQLite.
5. **Sequential chapter progression:** Chapter modules in the sidebar enforce prerequisite completion. Incomplete chapters lock subsequent modules with visual lock icons (`LOCK_ICON`).
6. **The badge exam is client-gated.** The 20-question exam, the 80% pass threshold, and the 80%-progress eligibility gate (32/40) are all enforced in `certification.html` JS, not the server. The server only stores progress for account sync.
7. **`ssh2` is an unused dependency** (historical leftover).
8. **No PDF generation remains.** The old `/api/certificate` endpoint (Puppeteer + Handlebars) and `certificate-template.html` were fully removed. The badge flow is entirely client-side: passing shows a message that the badge will be issued by the Linux Foundation via Credly.
9. **Security posture is mixed.** Auth endpoints are bcrypt-hashed and rate-limited, session cookies are `httpOnly`/`sameSite: lax`/`secure` in production, and progress requires auth. **However** `/api/proxy` and `/api/page` still accept arbitrary URLs (SSRF surface), the in-memory session store resets on restart, and the in-memory rate limiter doesn't scale across instances. Fine for an educational demo, but worth noting.
10. **Session store is in-memory (MemoryStore).** Sessions are lost on process restart/redeploy (users just re-login; progress is durable in the DB). Multiple instances would not share sessions without swapping to a shared store.
11. **Landing page progress is derived, not hardcoded.** `updateLandingProgress()` in `index.html` recomputes each curriculum card's bar from the sitemap + `moe_completed_quizzes`, so it matches real completion.
12. **Hardcoded content coupling:** `TERRAIN_URLS` in `app.js`, the welcome cards in `index.html`, and `flaggedPages` in `build-quizzes.js` all hardcode GitBook URLs, so content moves break these lists.
13. **Landing page has rich interactivity:** search with `/` keyboard shortcut, mobile hamburger menu, curriculum carousel with drag-to-scroll and arrow buttons, cursor-following magnetic stats in hero, and live progress bars on curriculum cards.

---

## 10. Pages with Quizzes and the COBOL Sandbox

### 10.1 Pages with Knowledge-Check Quizzes

Knowledge-check quizzes ship in `public/quizzes.json`, keyed by GitBook page URL. `renderQuiz(url)` in `app.js` attaches a quiz to any loaded page that has an entry; submitting it marks that page complete in `moe_completed_quizzes`, which drives the progress %, sidebar checkmarks, and badge-exam eligibility. **40 pages** have quizzes — **131 questions** in total (generated from the 74 flagged pages in `build-quizzes.js`; some pages were skipped during review):

**Introduction** (1 page, 3 questions)

| Page | Q | URL |
|---|---|---|
| Introduction: What is Enterprise Computing? | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/introduction-what-is-enterprise-computing.md` |

**Chapter 1 — What is a Mainframe Today?** (13 pages, 40 questions)

| Page | Q | URL |
|---|---|---|
| Role of the Mainframe Today | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-1-what-is-a-mainframe-today/role-of-the-mainframe-today.md` |
| Mainframe and the Cloud | 2 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-1-what-is-a-mainframe-today/role-of-the-mainframe-today/mainframe-and-the-cloud.md` |
| Enterprise Computing | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-1-what-is-a-mainframe-today/role-of-the-mainframe-today/enterprise-computing.md` |
| Hybrid Cloud | 2 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-1-what-is-a-mainframe-today/role-of-the-mainframe-today/hybrid-cloud.md` |
| Who Uses the Mainframe and Why | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-1-what-is-a-mainframe-today/who-uses-the-mainframe-and-why.md` |
| Mainframe Basic Architecture & Components | 4 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-1-what-is-a-mainframe-today/mainframe-basic-architecture-and-components.md` |
| How the Mainframe Works | 4 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-1-what-is-a-mainframe-today/how-the-mainframe-works.md` |
| Mainframe versus Server | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-1-what-is-a-mainframe-today/mainframe-versus-server.md` |
| Mainframe Security Myths | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-1-what-is-a-mainframe-today/mainframe-security-myths.md` |
| Mainframe Evolution | 4 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-1-what-is-a-mainframe-today/mainframe-evolution.md` |
| Looking Back: The First 50 Years of Mainframe | 4 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-1-what-is-a-mainframe-today/mainframe-evolution/looking-back-the-first-50-years-of-mainframe.md` |
| Mainframe Modernization | 2 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-1-what-is-a-mainframe-today/mainframe-modernization.md` |
| Zowe | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-1-what-is-a-mainframe-today/modern-mainframe/zowe.md` |

**Chapter 2 — Mainframe 101: Foundational Technology** (19 pages, 66 questions)

| Page | Q | URL |
|---|---|---|
| Enterprise Storage 101 | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/enterprise-storage-101.md` |
| TSO/E, ISPF, and UNIX System Services (USS): Interactive facilities of z/OS | 4 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/tso-e-ispf-and-unix-system-services-uss-interactive-facilities-of-z-os.md` |
| Understanding the JCL(Job Control Language) | 4 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/job-control-language-and-system-display-and-search-facility/understanding-the-jcl-job-control-language.md` |
| Understanding the JOB Statement | 4 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/job-control-language-and-system-display-and-search-facility/understanding-the-jcl-job-control-language/understanding-the-job-statement.md` |
| Understanding the EXEC Statement | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/job-control-language-and-system-display-and-search-facility/understanding-the-jcl-job-control-language/understanding-the-exec-statement.md` |
| Understanding the DD Statement | 4 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/job-control-language-and-system-display-and-search-facility/understanding-the-jcl-job-control-language/understanding-the-dd-statement.md` |
| Creating a Physical Sequential (PS) | 4 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/job-control-language-and-system-display-and-search-facility/understanding-the-jcl-job-control-language/creating-a-physical-sequential-ps.md` |
| Understanding Libraries in JCL | 4 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/job-control-language-and-system-display-and-search-facility/understanding-the-jcl-job-control-language/understanding-libraries-in-jcl.md` |
| Understanding Instream Procedures, Cataloged Procedures, and Symbolic Parameters in JCL | 4 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/job-control-language-and-system-display-and-search-facility/understanding-the-jcl-job-control-language/understanding-instream-procedures-cataloged-procedures-and-symbolic-parameters-in-jcl.md` |
| What is a Conditional Statement in JCL? | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/job-control-language-and-system-display-and-search-facility/what-is-a-conditional-statement-in-jcl.md` |
| JCL Conditional Parameter Types | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/job-control-language-and-system-display-and-search-facility/what-is-a-conditional-statement-in-jcl/jcl-conditional-parameter-types.md` |
| IEBCOMPR | 4 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/job-control-language-and-system-display-and-search-facility/utilities/iebcompr.md` |
| IEBGENER | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/job-control-language-and-system-display-and-search-facility/utilities/iebgener.md` |
| IEBCOPY | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/job-control-language-and-system-display-and-search-facility/utilities/iebcopy.md` |
| GDG parameters | 4 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/job-control-language-and-system-display-and-search-facility/gdg/gdg-parameters.md` |
| GDG base | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/job-control-language-and-system-display-and-search-facility/gdg/gdg-base.md` |
| GDG Generation | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/job-control-language-and-system-display-and-search-facility/gdg/gdg-generation.md` |
| Referencing GDG Generations Using Relative Numbers | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/job-control-language-and-system-display-and-search-facility/gdg/gdg-generation/referencing-gdg-generations-using-relative-numbers.md` |
| Alter and Delete GDG | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/job-control-language-and-system-display-and-search-facility/gdg/alter-and-delete-gdg.md` |

**Chapter 3 — Roles in Mainframe** (2 pages, 6 questions)

| Page | Q | URL |
|---|---|---|
| Roles and Categories | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-3-roles-in-mainframe/roles-and-categories.md` |
| Category Definitions | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-3-roles-in-mainframe/roles-and-categories/category-definitions.md` |

**Chapter 4 — Deeper Dive in Role Chosen** (3 pages, 9 questions)

| Page | Q | URL |
|---|---|---|
| IT Operations and System Support and Services | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-4-deeper-dive-in-role-chosen/it-operations-and-system-support-and-services.md` |
| IT Software Engineers | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-4-deeper-dive-in-role-chosen/it-software-engineers.md` |
| IT Architects | 3 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-4-deeper-dive-in-role-chosen/it-architects.md` |

**Mainframe 101 - Blog Series** (2 pages, 7 questions)

| Page | Q | URL |
|---|---|---|
| Mainframe 101 - Blog Series | 2 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/mainframe-101-blog-series.md` |
| Introduction to Mainframe Computing & Mainframe Hardware: A Complete Guide Across All Major Vendors | 5 | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/mainframe-101-blog-series/introduction-to-mainframe-computing-and-mainframe-hardware-a-complete-guide-across-all-major-vendors.md` |

### 10.2 Pages with the COBOL Sandbox

The COBOL sandbox appears in two places:

- **Global sandbox (every page):** the header **Sandbox** button (`setViewMode('sandbox')`, app.js) toggles a persistent COBOL editor (`#sandbox-container`) that can be opened from any page and posts to `POST /api/sandbox/execute`.
- **Inline sandbox (auto-injected):** `addInlineSandbox()` (app.js:1161) appends a "COBOL Sandbox" section to any page whose fetched content contains the word **"cobol"** (`hasCobolContent`, app.js:1155). It runs `cobol` code against the same `/api/sandbox/execute` endpoint.

Because the inline check runs against **live GitBook content at load time**, the list below is content-driven and can drift if the source pages change. **10 pages** currently trigger the inline sandbox (captured 11 Aug 2026):

| Page | URL |
|---|---|
| Programming languages for Mainframe | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology/programming-languages-for-mainframe.md` |
| Chapter 3: Roles in Mainframe | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-3-roles-in-mainframe.md` |
| IT Software Engineers | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-4-deeper-dive-in-role-chosen/it-software-engineers.md` |
| Scott McFall's Mainframe Journey | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-5-career-paths-and-opportunities/mainframe-journeys-from-student-to-professional/scott-mcfalls-mainframe-journey.md` |
| Job Opportunities | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-5-career-paths-and-opportunities/job-opportunities.md` |
| Global Mainframe Speaker Repository | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/additional-mainframe-resources/global-mainframe-speaker-repository.md` |
| Courses, Tutorials, Manuals | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/additional-mainframe-resources/courses-tutorials-manuals.md` |
| Education Programs | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/additional-mainframe-resources/education-programs.md` |
| IBM Mainframe Timeshare Services | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/additional-mainframe-resources/ibm-mainframe-timeshare-services.md` |
| Introduction to Mainframe Computing & Mainframe Hardware: A Complete Guide Across All Major Vendors | `https://open-mainframe-project.gitbook.io/mainframe-open-education-project/mainframe-101-blog-series/introduction-to-mainframe-computing-and-mainframe-hardware-a-complete-guide-across-all-major-vendors.md` |

---

## 11. Key Files at a Glance

| File | Lines | Role |
|---|---|---|
| `server.js` | 1,017 | All backend routes + GitBook scraping/preprocessing + account system + Credly badge issuance |
| `credly-badges.js` | 101 | Credly API integration, HTTP Basic auth header, badge issuance payload & dev simulation |
| `sitemap-parser.js` | 52 | Shared sitemap parser (supports indented sitemap.md & unindented live llms.txt) |
| `sitemap-cache.js` | 138 | In-memory sitemap cache, 1-hour refresh loop, live GitBook fetch, cold-boot fallback |
| `public/js/app.js` | 1,566 | Viewer behavior (SPA navigation, chapter locks, dual completion, quizzes, sandbox, palette, account integration) |
| `public/js/auth.js` | 256 | Shared account system: auth state, progress sync/merge, login/register modal UI |
| `public/css/style.css` | 2,996 | Reader/badge-exam design system (incl. account UI, enlarged progress bar, chapter locks) |
| `public/css/landing.css` | 1,889 | Landing page design system (incl. account UI, curriculum progress label, animations) |
| `public/viewer.html` | 174 | App shell: header, sidebar, content, TOC, command palette, auth modal |
| `public/index.html` | 1,006 | Marketing landing page (hero, brand showcase, journeys, curriculum w/ live progress bars, search, carousel, mobile nav) |
| `public/certification.html` | 784 | MOE Practitioner Badge exam + Credly badge claim flow & confirmation |
| `build-quizzes.js` | 224 | Offline quiz-generation CLI (Anthropic) |
| `quiz-prompt-template.txt` | 50 | Prompt/schema for quiz generation (claude-sonnet-4-20250514) |
| `sitemap.md` | 116 | Static cold-boot fallback table-of-contents (hierarchical links) |
| `public/quizzes.json` | 1,828 | Generated quizzes keyed by page URL (40 quizzes, 131 questions) |
| `data/moe.db` | — | Runtime SQLite database (gitignored; auto-created) |
