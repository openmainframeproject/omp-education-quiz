# Mainframe Open Education (MOE)
## LFX Mentorship Summer 2026 — Final Project Report & Comprehensive Handover Document
**Open Mainframe Project · The Linux Foundation**

---

## 1. Overview / Executive Summary

Mainframe Open Education (MOE) is an open-source educational initiative hosted by the **Open Mainframe Project** within **The Linux Foundation**, dedicated to lowering barriers to entry in enterprise mainframe computing. As part of the **LFX Mentorship Program for Summer 2026**, my role as Mentee Developer was to architect, engineer, and deploy an all-in-one interactive web learning platform that transforms MOE’s comprehensive GitBook curriculum into a modern, hands-on learning experience. The resulting platform delivers live upstream GitBook content synchronization, an in-browser GnuCOBOL execution sandbox, an automated 131-question knowledge-check assessment engine, a full student authentication and cloud progress tracking system, and an official Linux Foundation Credly badge examination and candidate claim workflow.

> **Core Impact Summary**
> Transformed static markdown documentation into an active e-learning platform with zero manual content migration. The application dynamically proxies 114 topics across 10 curriculum chapters, executes real COBOL code in the browser, tracks student progress in a hosted Turso/libSQL cloud database, and prepares candidate batches for official Linux Foundation Credly digital badge issuance.

---

## 2. Internship Context

The project was executed under the formal framework of The Linux Foundation Mentorship (LFX) Program during the Summer 2026 cohort.

* **Program:** The Linux Foundation Mentorship (LFX) Program — Summer 2026 Term
* **Host Project:** Mainframe Open Education (MOE) under the Open Mainframe Project (OMP)
* **Mentorship & Review Team:** Open Mainframe Project Technical Advisory Council (TAC) & MOE Working Group Leaders
* **Timeline:** June 1, 2026 – August 28, 2026 (12 Weeks)

### Milestone Progression

* **Phase 1: Weeks 1–3 (Architecture & Content Proxying)**
  Deconstructed GitBook Next.js hydration payloads, built the Express scraping and preprocessing engine, and created the initial Single Page Application (SPA) viewer.
* **Phase 2: Weeks 4–6 (Interactive Tooling & Sandbox)**
  Built and integrated the cloud COBOL compilation sandbox microservice and developed the offline Claude 3.5 Sonnet quiz generation pipeline producing 40 module quizzes (131 total questions).
* **Phase 3: Weeks 7–9 (Authentication & Progress System)**
  Designed the account management system with `bcryptjs` hashing, `express-session` cookies, and Turso/libSQL cloud database persistence with cross-device sync.
* **Phase 4: Weeks 10–11 (Live Sitemap Caching Engine)**
  Replaced static sitemap parsing with an auto-refreshing background cache engine (1-hour TTL) with cold-boot fallbacks and resilience guarantees.
* **Phase 5: Week 12 (Credly Pipeline, Admin Export & Final Handover)**
  Implemented the 20-question certification exam, server-side ≥80% curriculum eligibility gating, Credly badge claim flow, admin CSV candidate export for Linux Foundation, and 61-assertion automated test suite.

---

## 3. Work Completed & Platform Architecture

The application was engineered with a modular, highly resilient architecture designed to run efficiently on containerized cloud infrastructure while maintaining zero runtime dependencies on expensive third-party CMS platforms.

```
                    ┌──────────────────────────────────────────────┐
                    │               CLIENT BROWSER                 │
                    │   Vanilla JS SPA · CSS Design System · ⌘K    │
                    └───────┬──────────────────────────────▲───────┘
                            │                              │
                            │ HTTP / JSON                  │ Rendered HTML
                            ▼                              │ & State
                    ┌──────────────────────────────────────┴───────┐
                    │            EXPRESS BACKEND (Node.js)         │
                    │        server.js  ·  Port 3000 / Render      │
                    └───┬─────────────┬─────────────┬────────────┬─┘
                        │             │             │            │
         1-Hour Refresh │             │ Proxy Fetch │            │ Execute Code
                        ▼             ▼             ▼            ▼
        ┌──────────────────┐  ┌──────────────┐  ┌─────────┐  ┌─────────────────────────┐
        │  sitemap-cache   │  │   GitBook    │  │  Turso  │  │      COBOL Sandbox      │
        │ sitemap-parser   │  │  (Upstream   │  │ libSQL  │  │ GnuCOBOL Microservice   │
        │ 114 Pages / 10 Ch│  │  Markdown)   │  │ Cloud DB│  │ mainframe-sandbox       │
        └──────────────────┘  └──────────────┘  └─────────┘  └─────────────────────────┘
```

### 3.1 System Architecture & Technical Stack

* **Backend:** Node.js runtime with Express 4.x for RESTful routing, GitBook scraping/preprocessing, and session management.
* **Database:** Turso hosted libSQL (production) with seamless local SQLite fallback (`data/moe.db` in dev).
* **Frontend:** High-performance Vanilla JavaScript SPA with custom properties CSS design system, full dark mode, and command palette (`⌘K`).
* **COBOL Sandbox:** Dedicated Docker microservice running GnuCOBOL 3.1+ (deployed on Render at `https://mainframe-sandbox.onrender.com`).
* **Markdown Engine:** Marked 18.x with GitHub Flavored Markdown (GFM), line-break preservation, and GitBook tag callout preprocessors.
* **Deployment:** Multi-stage Dockerfile (`node:20-slim`) with Render web service blueprint (`.render.yaml`).

### 3.2 Key Features Shipped

#### A. Live Auto-Refreshing Sitemap Cache Engine (`sitemap-cache.js` & `sitemap-parser.js`)
Replaced static documentation maps with an intelligent background engine that synchronizes directly with upstream GitBook `llms.txt` every hour. Features an adaptive parser that handles both 2-space indented Markdown and unindented URL-hierarchy trees, 15-second abort timeouts, in-memory caching, and cold-boot fallback to local `sitemap.md` in case of network outages.

#### B. In-Browser GnuCOBOL Execution Sandbox
Integrated an interactive COBOL compilation playground directly inside lesson pages. Students can write, edit, and execute COBOL programs with instant terminal output (stdout, stderr, exit codes) without installing a local compiler or 3270 terminal emulator.

#### C. 131-Question Assessment & Dual Completion Engine
Developed an automated pipeline (`build-quizzes.js`) leveraging Claude 3.5 Sonnet to generate high-quality knowledge checks for all 40 core curriculum lesson pages. Implemented dual completion gating: pages with quizzes require a 100% score to mark as completed, while reading-only pages use an `IntersectionObserver` sentinel to complete upon reading to the bottom.

#### D. Student Authentication & Cloud Progress Tracking
Engineered a complete user account system using `bcryptjs` (12 salt rounds) and session cookies. Progress is stored in Turso/libSQL and automatically merges local browser progress into the cloud upon login, enabling students to switch between devices without losing completed chapters.

#### E. Credly Certification & Linux Foundation Badge Pipeline
Engineered the official MOE Practitioner Certification Exam (20 randomized questions from global pool, 80% passing grade). The server verifies that candidates have completed ≥80% of curriculum quizzes before accepting submissions. Candidate submissions are stored in the `badge_claims` table with status tracking.

#### F. Admin Reporting & CSV Candidate Export
Created secure admin endpoints (`/api/admin/badge-claims?format=csv`) allowing maintainers to instantly export candidate batches (ID, Name, Email, Exam Score, Date, Status) as a CSV file to attach to emails sent to the Linux Foundation badging desk.

#### G. Reader Sidebar & Dynamic Certification Unlock Card
Built a collapsible chapter accordion sidebar (Chapters 00 through 05 + More Resources) with live lock indicators, lesson count badges, and an interactive Badge Exam card that dynamically unlocks when the 80% threshold is reached.

---

## 4. Current Status & Verification

The platform is fully production-ready, thoroughly verified, and active on GitHub and Render.

* **Live Proxy:** All 114 documentation pages proxy live with active Next.js hydration extraction, syntax-highlighted code blocks, and dynamic image resolution.
* **Quiz Engine:** All 40 knowledge-check quizzes are fully functional with instant client feedback and progress persistence.
* **Sandbox:** Tested against live GnuCOBOL backend (`https://mainframe-sandbox.onrender.com`) returning exit code `0`.
* **Database:** Verified against hosted Turso cloud instance and local SQLite dev database.
* **Automated Tests:** All 61 automated test assertions across 2 test suites (`test-sitemap.js` + `test-credly.js`) pass 100% cleanly (`npm test`).

---

## 5. Long-Term Maintenance Plan

To ensure the platform remains secure, performant, and sustainable after the internship concludes, the following operational and maintenance protocols are established:

### 5.1 Infrastructure & Hosting Upkeep

* **Render Hosting:** The primary viewer (`moe-viewer`) runs on Render using the Dockerfile blueprint (`.render.yaml`). If deployed on the free tier, note that instances sleep after 15 minutes of inactivity (taking 30s to cold-start). Upgrading to a starter instance eliminates cold starts.
* **Sandbox Microservice:** The sandbox backend is hosted at `https://mainframe-sandbox.onrender.com`. Health checks can be verified via `POST /execute` with sample COBOL code.
* **Database Hosting:** Production accounts and completions reside in Turso Cloud. Turso handles automated multi-region replication and point-in-time recovery.

### 5.2 Dependency & Security Management

* **Security Audits:** Regularly execute `npm audit` and update core dependencies (`@libsql/client`, `express`, `bcryptjs`, `marked`).
* **Secret Rotation:** Set strong `SESSION_SECRET` and `ADMIN_SECRET` environment variables in Render to protect session signing and admin export endpoints.
* **Rate Limiting:** The in-memory rate limiter (`rateLimitAuth`) restricts authentication attempts to 10 per IP/email per 15-minute window.

### 5.3 Content Synchronization & Quiz Expansion

* **Auto-Refresh:** The platform automatically checks upstream GitBook `llms.txt` every 60 minutes. Any new pages or structural updates appear in the viewer within 1 hour without redeployment.
* **Quiz Bank Updates:** When new chapters are added to the GitBook, maintainers can run `node build-quizzes.js` (with `ANTHROPIC_API_KEY` set) to automatically generate new quizzes and append them to `public/quizzes.json`.

### 5.4 Badge Issuance Operating Procedure for Maintainers

To process candidate badges for the Linux Foundation / Credly desk:

1. **Step 1:** Log into an admin account or access:
   ```
   https://<your-app>.onrender.com/api/admin/badge-claims?format=csv&secret=<ADMIN_SECRET>
   ```
2. **Step 2:** Download the `moe_badge_candidates.csv` spreadsheet containing all eligible exam completers.
3. **Step 3:** Email the CSV to the Linux Foundation / Open Mainframe Project operations team for Credly badge issuance.
4. **Step 4:** Update the claim status in the Turso database from `"pending"` to `"issued"`.

### 5.5 Future Roadmap & Enhancements

* **Direct Credly API:** Configure direct `CREDLY_ORG_ID` and `CREDLY_AUTH_TOKEN` in `credly-badges.js` to enable 100% automated instant API badge dispatch.
* **Multi-Language Sandbox:** Expand sandbox compiler support to High-Level Assembler (HLASM), Job Control Language (JCL), and REXX scripts.
* **LMS Integration:** Implement LTI 1.3 standards to allow university professors to embed MOE modules directly into Canvas, Blackboard, or Moodle.
* **Hardware Visualization:** Add interactive 3D z/Architecture mainframe hardware component diagrams.

### 5.6 Ownership & Support Model

* **Project Ownership:** Open Mainframe Project Technical Advisory Council (TAC) & MOE Working Group.
* **Primary Developer:** Tushar B. (LFX Mentee Developer 2026) — Available for technical handoff questions.
* **Community Escalation:** Open Mainframe Project Slack (`#moe-working-group`) and GitHub Repository Issues.

---

## 6. Appendix & Technical Specifications

### 6.1 Key Repository & Service URLs

* **GitHub Repository:** `https://github.com/TusharB-07/Mainframe_Open_Education`
* **Upstream GitBook Source:** `https://open-mainframe-project.gitbook.io/mainframe-open-education-project`
* **COBOL Sandbox Endpoint:** `https://mainframe-sandbox.onrender.com`

### 6.2 Database Schema (Turso / SQLite)

| Table Name | Primary Key | Columns |
|---|---|---|
| `users` | `id` (INTEGER PK AUTOINCREMENT) | `email` (UNIQUE), `password_hash`, `first_name`, `last_name`, `created_at` |
| `progress` | `(user_id, page_url)` | `completed_at` (TEXT timestamp) |
| `badge_claims` | `id` (INTEGER PK), `user_id` (UNIQUE) | `first_name`, `last_name`, `email`, `exam_score`, `status`, `claimed_at` |
| `badges` | `(user_id, badge_template_id)` | `credly_badge_id`, `issued_at` |

### 6.3 Complete Backend REST API Catalog

| Method & Endpoint | Auth | Description & Response |
|---|---|---|
| `GET /api/sitemap` | Public | Returns `{ tree, lastRefreshedAt, stale }` from 1h in-memory cache. |
| `GET /api/page?url=&mode=` | Public | Proxies & transforms GitBook page into sanitized HTML + TOC + Quiz. |
| `POST /api/sandbox/execute` | Public | Forwards `{ language, code }` to COBOL sandbox microservice. |
| `POST /api/auth/register` | Public | Creates account (`bcrypt` 12 rounds), sets session cookie. |
| `POST /api/auth/login` | Public | Authenticates user credentials and starts session. |
| `POST /api/auth/logout` | Public | Destroys session and clears `connect.sid` cookie. |
| `GET /api/auth/me` | Public | Returns current user profile `{ id, email, firstName, lastName }` or `null`. |
| `GET /api/progress` | Required | Returns `{ pages: [...] }` completed by authenticated user. |
| `POST /api/progress` | Required | Records individual page completion in `progress` table. |
| `POST /api/progress/sync` | Required | Replaces full progress set for cross-device synchronization. |
| `GET /api/certification/status` | Required | Returns `{ claimed: boolean, firstName, lastName, examScore, status }`. |
| `POST /api/certification/claim` | Required | Verifies ≥80% curriculum completion (≥32/40) and saves candidate badge claim. |
| `GET /api/admin/badge-claims` | Admin/Auth | Exports candidate list for Linux Foundation (JSON or `?format=csv`). |

### 6.4 Environment Variables Reference

| Variable Name | Default / Value | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP server listening port. |
| `SANDBOX_URL` | `https://mainframe-sandbox.onrender.com` | Remote COBOL compilation execution endpoint. |
| `SESSION_SECRET` | *(Auto-generated in Render)* | Cryptographic signing key for session cookies. |
| `ADMIN_SECRET` | *(Optional, falls back to session secret)* | API key for accessing `/api/admin/badge-claims`. |
| `TURSO_DATABASE_URL` | `libsql://...` or `file:data/moe.db` | Database connection string. |
| `TURSO_AUTH_TOKEN` | *(From Turso Dashboard)* | Authentication token for hosted Turso DB. |
| `CREDLY_ORG_ID` | *(Optional / Direct API)* | Credly Organization ID for direct automated issuance. |
| `CREDLY_AUTH_TOKEN` | *(Optional / Direct API)* | Credly Developer Authorization Token. |

### 6.5 Key Codebase Files Inventory

| File Path | Lines | Primary Function |
|---|---|---|
| `server.js` | 1,078 | Express backend, routing, auth, GitBook proxying, admin export. |
| `credly-badges.js` | 101 | Credly v1 API client, Basic Auth header, payload generator. |
| `sitemap-parser.js` | 52 | Universal parser for indented and unindented sitemap trees. |
| `sitemap-cache.js` | 138 | 1-hour auto-refresh loop, memory cache, GitBook fetcher, fallback. |
| `public/js/app.js` | 1,590 | SPA viewer logic, sidebar accordion, chapter locks, COBOL runner. |
| `public/js/auth.js` | 256 | Shared client auth state, `mergeProgress()`, modal dialogs. |
| `public/css/style.css` | 3,135 | Main reader & badge exam design system, dark mode, responsive styles. |
| `public/css/landing.css` | 1,889 | Marketing landing page styles, animations, carousel. |
| `public/index.html` | 1,006 | Landing page markup, hero, learning journeys, curriculum progress. |
| `public/viewer.html` | 174 | Application shell, top header, sidebar, TOC, command palette. |
| `public/certification.html` | 784 | 20-question randomized exam, pass evaluation, candidate claim flow. |
| `public/quizzes.json` | 1,829 | 40 module quizzes containing 131 vetted questions. |
| `test-sitemap.js` | 185 | Automated test suite (29 tests) for parser, cache, HTTP contracts. |
| `test-credly.js` | 178 | Automated test suite (32 tests) for claims, gates, CSV export. |
| `PROJECT_ANALYSIS.md` | 561 | Comprehensive technical codebase analysis and architectural spec. |

---

*— End of Final Handover Document —*
