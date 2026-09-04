let sitemapData = null;
let currentUrl = null;
let currentTitle = '';
let currentMode = 'auto';
let quizzesData = null;
const GITHUB_BASE = 'https://github.com/open-mainframe-project/mainframe-open-education/blob/main';

function calculateReadTime(text, wpm = 200) {
    const words = text.trim().split(/\s+/).length;
    const minutes = Math.max(1, Math.ceil(words / wpm));
    return `${minutes} min read`;
}

function updateReadTime() {
    const contentEl = document.getElementById('page-content');
    const readTimeEl = document.getElementById('read-time');
    if (!contentEl || !readTimeEl) return;
    // Exclude code blocks (pre and code tags) from word count
    const clone = contentEl.cloneNode(true);
    clone.querySelectorAll('pre, code').forEach(el => el.remove());
    const text = clone.textContent || '';
    if (!text.trim()) {
        readTimeEl.textContent = '';
    } else {
        readTimeEl.textContent = calculateReadTime(text);
    }
}

async function fetchSitemap() {
  const res = await fetch('/api/sitemap');
  const data = await res.json();
  if (data && Array.isArray(data.tree)) {
    if (data.stale) {
      console.warn('[sitemap] Serving cached sitemap (stale)');
    }
    return data.tree;
  }
  return Array.isArray(data) ? data : [];
}

async function fetchPageContent(url, mode) {
  let endpoint = `/api/page?url=${encodeURIComponent(url)}`;
  if (mode === 'raw') endpoint += '&mode=raw';
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error('Failed to load page');
  return res.json();
}

async function loadQuizzes() {
  try {
    const res = await fetch('/quizzes.json');
    if (res.ok) quizzesData = await res.json();
  } catch {
    quizzesData = {};
  }
}

const LOCK_ICON = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

const CHAPTER_DIFFICULTY = {
  'Introduction: What is Enterprise Computing?': 'Beginner',
  'Chapter 1: What is a Mainframe Today?': 'Beginner',
  'Chapter 2: Mainframe 101 - Foundational Technology': 'Beginner',
  'Chapter 3: Roles in Mainframe': 'Beginner',
  'Chapter 4: Deeper Dive in Role Chosen': 'Intermediate',
  'Chapter 5: Career Paths and Opportunities': 'Intermediate',
};

const MORE_SECTION_TITLES = ['Additional Mainframe Resources', 'Backlog on Topics', 'Mainframe 101 - Blog Series'];

// Sections that are rendered in the sidebar but do NOT count toward progress.
// The Welcome section is a contributor guide, not part of the chapter journey,
// so the progress bar denominator covers the 6 curriculum chapters only.
const NON_PROGRESS_TITLES = ['Welcome: Learn & Contribute to MOE', ...MORE_SECTION_TITLES];

let chapterModules = [];

function formatDuration(minutes) {
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${minutes}m`;
}

function countSectionLessons(node) {
  let count = 0;
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (n.url) count++;
    stack.push(...(n.children || []));
  }
  return count;
}

function collectChapterSteps(node) {
  const steps = [];
  if (node.url) steps.push({ type: 'overview', title: node.title, url: node.url });
  for (const child of node.children || []) {
    if (child.children && child.children.length) {
      if (child.url) steps.push({ type: 'step', title: child.title, url: child.url });
      steps.push({ type: 'group', title: child.title });
      collectLeaves(child, steps);
    } else if (child.url) {
      steps.push({ type: 'step', title: child.title, url: child.url });
    }
  }
  return steps;
}

function collectLeaves(node, steps) {
  for (const child of node.children || []) {
    if (child.children && child.children.length) {
      if (child.url) steps.push({ type: 'step', title: child.title, url: child.url });
      steps.push({ type: 'group', title: child.title });
      collectLeaves(child, steps);
    } else if (child.url) {
      steps.push({ type: 'step', title: child.title, url: child.url });
    }
  }
}

function buildChapterSidebar(nodes, container) {
  container.innerHTML = '';
  chapterModules = [];
  const journey = [];
  const more = [];
  nodes.forEach((node) => {
    const isMore = MORE_SECTION_TITLES.includes(node.title);
    const lessons = collectChapterSteps(node);
    const lessonCount = countSectionLessons(node);
    const difficulty = CHAPTER_DIFFICULTY[node.title] || (isMore ? 'Resources' : 'Starter');
    const mod = { node, lessons, lessonCount, minutes: lessonCount * 15, difficulty, isMore, countsInProgress: !NON_PROGRESS_TITLES.includes(node.title) };
    (isMore ? more : journey).push(mod);
  });
  journey.forEach((mod, i) => {
    const el = buildChapterModule(mod, i);
    chapterModules.push({ el, node: mod.node, isMore: false, countsInProgress: mod.countsInProgress });
    container.appendChild(el);
  });
  if (more.length) {
    const divider = document.createElement('div');
    divider.className = 'chapter-divider';
    divider.textContent = 'More';
    container.appendChild(divider);
    more.forEach((mod, i) => {
      const el = buildChapterModule(mod, 7 + i);
      chapterModules.push({ el, node: mod.node, isMore: true, countsInProgress: false });
      container.appendChild(el);
    });
  }
  container.appendChild(buildCertificationBanner());
}

function buildCertificationBanner() {
  const card = document.createElement('div');
  card.className = 'sidebar-cert-card';
  card.id = 'sidebar-cert-card';
  card.innerHTML = `
    <a href="/certification" class="sidebar-cert-link" title="MOE Practitioner Badge Examination">
      <div class="sidebar-cert-top">
        <span class="sidebar-cert-icon">🎖️</span>
        <div class="sidebar-cert-info">
          <div class="sidebar-cert-title">Badge Certification</div>
          <div class="sidebar-cert-sub">MOE Practitioner Exam</div>
        </div>
        <span class="sidebar-cert-arrow">↗</span>
      </div>
      <div class="sidebar-cert-status" id="sidebar-cert-status">
        <span class="cert-status-pill locked">80% quizzes required</span>
      </div>
    </a>
  `;
  return card;
}

function buildChapterModule(mod, index) {
  const el = document.createElement('div');
  el.className = 'chapter-module';
  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'chapter-header';
  header.innerHTML = `
    <span class="chapter-index">${String(index).padStart(2, '0')}</span>
    <span class="chapter-main">
      <span class="chapter-title">${escapeHtml(mod.node.title)}</span>
      <span class="chapter-meta">
        <span class="chapter-count">${mod.lessonCount} ${mod.lessonCount === 1 ? 'lesson' : 'lessons'}</span>
        <span class="chapter-duration">${formatDuration(mod.minutes)}</span>
        <span class="chapter-badge">${escapeHtml(mod.difficulty)}</span>
      </span>
      <span class="chapter-progress">
        <span class="chapter-progress-bar"><span class="chapter-progress-fill"></span></span>
        <span class="chapter-progress-pct"></span>
      </span>
    </span>
    <span class="chapter-chevron">\u25BE</span>
  `;
  const body = document.createElement('div');
  body.className = 'chapter-body';
  for (const item of mod.lessons) body.appendChild(buildLessonItem(item));
  el.appendChild(header);
  el.appendChild(body);
  header.addEventListener('click', () => {
    const isOpen = el.classList.contains('open');
    document.querySelectorAll('.chapter-module.open').forEach(m => m.classList.remove('open'));
    if (!isOpen) el.classList.add('open');
  });
  return el;
}

function buildLessonItem(item) {
  if (item.type === 'group') {
    const g = document.createElement('div');
    g.className = 'lesson-group';
    g.textContent = item.title;
    return g;
  }
  const a = document.createElement('a');
  a.className = 'lesson-step';
  a.href = '#';
  a.dataset.url = item.url;
  a.dataset.title = item.title;
  const status = document.createElement('span');
  status.className = 'lesson-status';
  const t = document.createElement('span');
  t.className = 'lesson-title';
  t.textContent = item.title;
  a.appendChild(status);
  a.appendChild(t);
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const node = findNodeByUrl(sitemapData, item.url);
    if (node) loadPage(node);
  });
  return a;
}

function chapterPages(node) {
  const pages = [];
  (function walk(n) {
    if (n.url) pages.push(n.url);
    for (const c of n.children || []) walk(c);
  })(node);
  return pages;
}

function setActiveNavItem(url) {
  document.querySelectorAll('.lesson-step.current').forEach(el => el.classList.remove('current'));
  if (!url) return;
  const step = document.querySelector(`.lesson-step[data-url="${CSS.escape(url)}"]`);
  if (!step) return;
  step.classList.add('current');
  document.querySelectorAll('.chapter-module.open').forEach(m => m.classList.remove('open'));
  const mod = step.closest('.chapter-module');
  if (mod) mod.classList.add('open');
}

function findNodeByUrl(nodes, url) {
  for (const node of nodes) {
    if (node.url === url) return node;
    if (node.children) {
      const found = findNodeByUrl(node.children, url);
      if (found) return found;
    }
  }
  return null;
}

function flattenSitemap(nodes) {
  const result = [];
  for (const node of nodes) {
    if (node.url) result.push(node);
    if (node.children) result.push(...flattenSitemap(node.children));
  }
  return result;
}

function renderPageNav(url) {
  const flat = flattenSitemap(sitemapData);
  const idx = flat.findIndex(n => n.url === url);
  if (idx === -1) return '';
  const prev = idx > 0 ? flat[idx - 1] : null;
  const next = idx < flat.length - 1 ? flat[idx + 1] : null;
  if (!prev && !next) return '';
  let html = '<div class="page-nav">';
  if (prev) {
    html += `<a class="page-nav-link page-nav-prev" href="#" data-url="${escapeHtml(prev.url)}"><span class="page-nav-direction">Previous</span><span class="page-nav-title">${escapeHtml(prev.title)}</span></a>`;
  } else {
    html += '<span class="page-nav-spacer"></span>';
  }
  if (next) {
    html += `<a class="page-nav-link page-nav-next" href="#" data-url="${escapeHtml(next.url)}"><span class="page-nav-direction">Next</span><span class="page-nav-title">${escapeHtml(next.title)}</span></a>`;
  }
  html += '</div>';
  return html;
}

/* ── Progress Tracking ── */

function getCompletedQuizzes() {
  try {
    return JSON.parse(localStorage.getItem('moe_completed_quizzes') || '[]');
  } catch { return []; }
}

function isQuizCompleted(pageUrl) {
  return getCompletedQuizzes().includes(pageUrl);
}

function isQuizPage(pageUrl) {
  return !!(quizzesData && quizzesData[pageUrl]);
}

function getJourneyLessons() {
  const lessons = [];
  chapterModules.forEach((m) => {
    if (!m.countsInProgress) return;
    m.el.querySelectorAll('.lesson-step').forEach((step) => {
      if (step.dataset.url === WELCOME_URL) return;
      lessons.push({ url: step.dataset.url, title: step.dataset.title });
    });
  });
  return lessons;
}

function getFirstIncompleteLesson() {
  const completed = getCompletedQuizzes();
  return getJourneyLessons().find(l => !completed.includes(l.url)) || null;
}

function getFirstLesson() {
  return getJourneyLessons().find(l => l.url !== WELCOME_URL) || null;
}

function markPageCompleted(pageUrl) {
  const list = getCompletedQuizzes();
  if (!list.includes(pageUrl)) {
    list.push(pageUrl);
    localStorage.setItem('moe_completed_quizzes', JSON.stringify(list));
  }
  if (window.MOE_AUTH) window.MOE_AUTH.report(pageUrl);
  updateProgressUI();
  updateSidebarCheckmarks();
  addPageMeta(pageUrl);
}

function markQuizCompleted(pageUrl) {
  markPageCompleted(pageUrl);
}

function ensureWelcomeCompleted() {
  if (!isQuizCompleted(WELCOME_URL)) markPageCompleted(WELCOME_URL);
}

function getProgress() {
  const completed = getCompletedQuizzes();
  const journeyMods = chapterModules.filter(m => m.countsInProgress);
  const total = journeyMods.reduce((s, m) => s + countSectionLessons(m.node), 0);
  const done = journeyMods.reduce((s, m) => s + chapterPages(m.node).filter(u => completed.includes(u)).length, 0);
  return { completed: done, total, percentage: total > 0 ? Math.round((done / total) * 100) : 0 };
}

function updateProgressUI() {
  const { completed, total, percentage } = getProgress();
  const textEl = document.getElementById('progress-text');
  const fillEl = document.getElementById('progress-fill');
  if (textEl) textEl.textContent = `Progress: ${completed}/${total}`;
  if (fillEl) fillEl.style.width = `${percentage}%`;
}

/* ── Scroll-to-complete (pages without a quiz) ── */
let scrollCompleteObserver = null;
let scrollCompleteDwellTimer = null;
let tocScrollObserver = null;

function clearScrollCompletion() {
  if (scrollCompleteDwellTimer) {
    clearTimeout(scrollCompleteDwellTimer);
    scrollCompleteDwellTimer = null;
  }
  if (scrollCompleteObserver) {
    scrollCompleteObserver.disconnect();
    scrollCompleteObserver = null;
  }
}

function setupScrollCompletion(url) {
  clearScrollCompletion();
  if (!url) return;
  if (isQuizCompleted(url)) return;
  if (isQuizPage(url)) return;
  const contentEl = document.getElementById('page-content');
  if (!contentEl) return;
  const sentinel = document.createElement('div');
  sentinel.className = 'page-end-sentinel';
  contentEl.appendChild(sentinel);

  const complete = () => {
    markPageCompleted(url);
    clearScrollCompletion();
  };

  /* Sentinel sits at the very end of the page (after prev/next nav + edit
     link). It fires the instant it becomes visible in the scrolled container,
     i.e. when the reader reaches the bottom of the page. No bottom margin is
     used: a negative margin would exclude the lower part of the viewport and
     keep the pinned bottom sentinel from ever entering the check zone. */
  scrollCompleteObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        complete();
        return;
      }
    }
  }, { threshold: 0, rootMargin: '0px 0px 0px 0px' });
  scrollCompleteObserver.observe(sentinel);

  /* Read-time fallback: auto-complete after a fraction of the page's read
     time, so long pages never get stuck just because the user didn't scroll
     to the exact bottom edge. */
  const words = (contentEl.textContent || '').trim().split(/\s+/).length;
  const readSeconds = (words / 200) * 60;
  const dwellMs = Math.min(Math.max(Math.round(readSeconds * 0.6) * 1000, 5000), 60000);
  scrollCompleteDwellTimer = setTimeout(complete, dwellMs);
}

function updateSidebarCheckmarks() {
  const completed = getCompletedQuizzes();
  const currentIdx = currentUrl ? chapterModules.findIndex(m => chapterPages(m.node).includes(currentUrl)) : -1;

  const completeFlags = chapterModules.map(mod => {
    const pages = chapterPages(mod.node);
    const done = pages.filter(u => completed.includes(u)).length;
    return { pct: pages.length ? Math.round((done / pages.length) * 100) : 0, complete: done === pages.length, pages: pages.length };
  });

  chapterModules.forEach((mod, i) => {
    const el = mod.el;
    const { pct, pages } = completeFlags[i];
    const prevComplete = i === 0 || completeFlags[i - 1].complete;
    const isLocked = currentIdx >= 0 && i > currentIdx && !prevComplete;

    el.classList.toggle('locked', isLocked);
    const fill = el.querySelector('.chapter-progress-fill');
    const pctEl = el.querySelector('.chapter-progress-pct');
    if (fill) fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = pages ? pct + '%' : '';

    el.querySelectorAll('.lesson-step').forEach(step => {
      const url = step.dataset.url;
      if (!url) return;
      const done = completed.includes(url);
      const isCurrent = url === currentUrl;
      const locked = isLocked && !isCurrent;
      step.classList.toggle('completed', done);
      step.classList.toggle('current', isCurrent);
      step.classList.toggle('locked', locked);
      const status = step.querySelector('.lesson-status');
      if (status) {
        if (done) status.textContent = '\u2713';
        else if (locked) status.innerHTML = LOCK_ICON;
        else if (isCurrent) status.textContent = '\u25CF';
        else status.textContent = '';
      }
    });
  });
  updateSidebarSummary();
}

function updateSidebarSummary() {
  const completed = getCompletedQuizzes();
  const journeyMods = chapterModules.filter(m => m.countsInProgress);
  const total = journeyMods.reduce((s, m) => s + countSectionLessons(m.node), 0);
  const done = journeyMods.reduce((s, m) => s + chapterPages(m.node).filter(u => completed.includes(u)).length, 0);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const pctEl = document.getElementById('sp-pct');
  const fillEl = document.getElementById('sidebar-progress-fill');
  const countEl = document.getElementById('sp-count');
  if (pctEl) pctEl.textContent = pct + '%';
  if (fillEl) fillEl.style.width = pct + '%';
  if (countEl) countEl.textContent = `${done} of ${total} lessons`;

  const wPctEl = document.getElementById('welcome-progress-pct');
  const wFillEl = document.getElementById('welcome-progress-fill');
  const wCountEl = document.getElementById('welcome-progress-count');
  if (wPctEl) wPctEl.textContent = pct + '%';
  if (wFillEl) wFillEl.style.width = pct + '%';
  if (wCountEl) wCountEl.textContent = `${done} of ${total} lessons`;

  const quizTotal = journeyMods.reduce((s, m) => s + chapterPages(m.node).filter(u => isQuizPage(u)).length, 0);
  const quizDone = journeyMods.reduce((s, m) => s + chapterPages(m.node).filter(u => isQuizPage(u) && completed.includes(u)).length, 0);
  const wQuizEl = document.getElementById('welcome-progress-quiz');
  if (wQuizEl) {
    wQuizEl.textContent = quizTotal ? `${quizDone} of ${quizTotal} knowledge checks passed` : '';
    wQuizEl.classList.toggle('complete', quizTotal > 0 && quizDone === quizTotal);
  }

  // Update Sidebar Certification Badge card
  const certCard = document.getElementById('sidebar-cert-card');
  const certStatus = document.getElementById('sidebar-cert-status');
  if (certCard && certStatus) {
    const totalQuizzes = (quizzesData && Object.keys(quizzesData).length) || 40;
    const completedCount = completed.length;
    const requiredCount = Math.ceil(0.8 * totalQuizzes);
    const isUnlocked = completedCount >= requiredCount;

    certCard.classList.toggle('unlocked', isUnlocked);
    if (isUnlocked) {
      certStatus.innerHTML = '<span class="cert-status-pill unlocked">🎉 Exam Unlocked! Take Exam</span>';
    } else {
      const pctDone = Math.round((completedCount / totalQuizzes) * 100);
      certStatus.innerHTML = `<span class="cert-status-pill locked">${completedCount}/${requiredCount} completed (${pctDone}%)</span>`;
    }
  }
}

/* ── Quiz ── */
function renderQuiz(url) {
  if (!quizzesData || !quizzesData[url]) return;
  const quizData = quizzesData[url];
  const container = document.createElement('div');
  container.className = 'quiz-container';
  container.id = 'quiz-container';
  const heading = document.createElement('h2');
  heading.className = 'quiz-heading';
  heading.textContent = 'Knowledge Check';
  container.appendChild(heading);
  const form = document.createElement('form');
  form.className = 'quiz-form';
  form.noValidate = true;
  for (const q of quizData.questions) {
    const qEl = document.createElement('div');
    qEl.className = 'quiz-question';
    qEl.dataset.questionId = q.id;
    const prompt = document.createElement('div');
    prompt.className = 'quiz-prompt';
    prompt.textContent = q.prompt;
    qEl.appendChild(prompt);
    const optionsEl = document.createElement('div');
    optionsEl.className = 'quiz-options';
    const isMulti = q.type === 'multi';
    const inputType = isMulti ? 'checkbox' : 'radio';
    const nameAttr = q.id;
    for (let i = 0; i < q.options.length; i++) {
      const label = document.createElement('label');
      label.className = 'quiz-option';
      const input = document.createElement('input');
      input.type = inputType;
      input.name = isMulti ? `${nameAttr}_${i}` : nameAttr;
      input.value = i;
      input.dataset.index = i;
      const span = document.createElement('span');
      span.className = 'quiz-option-text';
      span.textContent = q.options[i];
      label.appendChild(input);
      label.appendChild(span);
      optionsEl.appendChild(label);
    }
    qEl.appendChild(optionsEl);
    form.appendChild(qEl);
  }
  const submitBtn = document.createElement('button');
  submitBtn.type = 'button';
  submitBtn.className = 'quiz-submit';
  submitBtn.textContent = 'Submit Answers';
  form.appendChild(submitBtn);
  const resultEl = document.createElement('div');
  resultEl.className = 'quiz-result';
  form.appendChild(resultEl);
  const retakeBtn = document.createElement('button');
  retakeBtn.type = 'button';
  retakeBtn.className = 'quiz-retake';
  retakeBtn.textContent = 'Retake Quiz';
  retakeBtn.style.display = 'none';
  form.appendChild(retakeBtn);
  submitBtn.addEventListener('click', () => gradeQuiz(form, quizData.questions, resultEl, submitBtn, retakeBtn, url));
  retakeBtn.addEventListener('click', () => retakeQuiz(form, quizData.questions, resultEl, submitBtn, retakeBtn));
  container.appendChild(form);
  return container;
}

function gradeQuiz(form, questions, resultEl, submitBtn, retakeBtn, pageUrl) {
  let correctCount = 0;
  const total = questions.length;
  for (const q of questions) {
    const qEl = form.querySelector(`.quiz-question[data-question-id="${q.id}"]`);
    const inputs = qEl.querySelectorAll('input:checked');
    const allInputs = qEl.querySelectorAll('input');
    const selected = Array.from(inputs).map(inp => parseInt(inp.value));
    const isCorrect = Array.isArray(q.answer)
      ? selected.length === q.answer.length && q.answer.every(a => selected.includes(a))
      : selected.length === 1 && selected[0] === q.answer;
    if (isCorrect) correctCount++;
    for (const inp of allInputs) {
      const idx = parseInt(inp.value);
      const isCorrectAnswer = Array.isArray(q.answer) ? q.answer.includes(idx) : q.answer === idx;
      inp.disabled = true;
      const label = inp.closest('.quiz-option');
      if (isCorrectAnswer) {
        label.classList.add('correct');
      } else if (inp.checked && !isCorrectAnswer) {
        label.classList.add('incorrect');
      }
    }
  }
  const score = Math.round((correctCount / total) * 100);
  const allCorrect = correctCount === total;
  resultEl.className = 'quiz-result visible';
  resultEl.innerHTML = allCorrect
    ? `<span class="quiz-score quiz-passed">&#10003; Quiz Passed! (${score}%)</span>`
    : `<span class="quiz-score">${correctCount}/${total} correct (${score}%)</span>`;
  submitBtn.style.display = 'none';
  retakeBtn.style.display = '';
  if (pageUrl) markQuizCompleted(pageUrl);
}

function retakeQuiz(form, questions, resultEl, submitBtn, retakeBtn) {
  const questionEls = form.querySelectorAll('.quiz-question');
  for (const qEl of questionEls) {
    const inputs = qEl.querySelectorAll('input');
    for (const inp of inputs) {
      inp.checked = false;
      inp.disabled = false;
      inp.closest('.quiz-option').classList.remove('correct', 'incorrect');
    }
  }
  resultEl.className = 'quiz-result';
  resultEl.innerHTML = '';
  submitBtn.style.display = '';
  retakeBtn.style.display = 'none';
}

function findPathToNode(nodes, url, path = []) {
  for (const node of nodes) {
    const currentPath = [...path, node.title];
    if (node.url === url) return currentPath;
    if (node.children) {
      const found = findPathToNode(node.children, url, currentPath);
      if (found) return found;
    }
  }
  return null;
}

function renderPageToc(headings) {
  const toc = document.getElementById('page-toc');
  if (!headings || headings.length === 0) {
    toc.innerHTML = '';
    toc.style.display = 'none';
    return;
  }
  let html = '<div class="toc-header">On this page</div>';
  for (const h of headings) {
    const indent = (h.level - 2) * 12;
    html += `<a class="toc-item" href="#${escapeHtml(h.id)}" data-toc-id="${escapeHtml(h.id)}" style="padding-left:${12 + indent}px">${escapeHtml(h.text)}</a>`;
  }
  toc.innerHTML = html;
  toc.style.display = 'block';
}

function updateBreadcrumb(url) {
  const breadcrumb = document.getElementById('breadcrumb');
  if (!url) { breadcrumb.innerHTML = ''; return; }
  const path = findPathToNode(sitemapData, url);
  if (!path) { breadcrumb.innerHTML = ''; return; }
  const parts = path.map((p, i) => {
    if (i === path.length - 1) return `<span>${escapeHtml(p)}</span>`;
    return `<a href="#" class="breadcrumb-item">${escapeHtml(p)}</a>`;
  });
  breadcrumb.innerHTML = parts.join('<span class="breadcrumb-sep">/</span>');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const WELCOME_URL = 'https://open-mainframe-project.gitbook.io/mainframe-open-education-project/welcome-learn-and-contribute-to-moe.md';
let welcomeHtml = '';

function showWelcome(title) {
  const contentEl = document.getElementById('page-content');
  contentEl.className = '';
  clearScrollCompletion();
  contentEl.innerHTML = welcomeHtml;
  renderPageToc(null);
  addFeedbackWidget();
  updateBreadcrumb(null);
  setActiveNavItem(null);
  updateSidebarSummary();
  updateSidebarCheckmarks();
  ensureWelcomeCompleted();
  renderRemainingLessons();
  const readTimeEl = document.getElementById('read-time');
  if (readTimeEl) readTimeEl.textContent = '';
  document.title = title ? `${title} - MOE Documentation` : 'Mainframe Open Education';
  resetContentScroll();
}

function renderRemainingLessons() {
  const container = document.getElementById('page-content');
  const existing = container.querySelector('.welcome-remaining');
  if (existing) existing.remove();
  const completed = getCompletedQuizzes();
  const remaining = getJourneyLessons()
    .filter(l => !completed.includes(l.url))
    .map(l => ({ ...l, quiz: isQuizPage(l.url) }))
    .sort((a, b) => (b.isQuiz - a.isQuiz) || a.title.localeCompare(b.title));
  const block = document.createElement('div');
  block.className = 'welcome-remaining';
  const header = document.createElement('div');
  header.className = 'welcome-remaining-head';
  const label = document.createElement('span');
  label.className = 'welcome-remaining-label';
  const count = document.createElement('span');
  count.className = 'welcome-remaining-count';
  header.appendChild(label);
  header.appendChild(count);
  block.appendChild(header);
  if (remaining.length === 0) {
    label.textContent = 'All lessons completed';
    count.textContent = '\u2713';
    block.classList.add('complete');
  } else {
    label.textContent = 'Lessons still to complete';
    count.textContent = `${remaining.length} remaining`;
    const list = document.createElement('ul');
    list.className = 'welcome-remaining-list';
    const shown = remaining.slice(0, 20);
    shown.forEach(l => {
      const li = document.createElement('li');
      li.className = 'welcome-remaining-item';
      const a = document.createElement('a');
      a.href = '#';
      a.className = 'welcome-remaining-link';
      a.dataset.url = l.url;
      a.textContent = l.title;
      li.appendChild(a);
      if (l.isQuiz) {
        const tag = document.createElement('span');
        tag.className = 'welcome-remaining-tag';
        tag.textContent = 'Quiz: submit to confirm';
        li.appendChild(tag);
      }
      list.appendChild(li);
    });
    block.appendChild(list);
    if (remaining.length > shown.length) {
      const more = document.createElement('div');
      more.className = 'welcome-remaining-more';
      more.textContent = `+${remaining.length - shown.length} more`;
      block.appendChild(more);
    }
  }
  const welcome = container.querySelector('.welcome');
  if (welcome) welcome.appendChild(block);
  block.querySelectorAll('.welcome-remaining-link').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const node = findNodeByUrl(sitemapData, a.dataset.url);
      if (node) loadPage(node);
    });
  });
}

function resetContentScroll() {
  const scroller = document.getElementById('content-area');
  if (scroller) scroller.scrollTop = 0;
  window.scrollTo(0, 0);
}

function addCopyButtons() {
  document.querySelectorAll('#page-content pre').forEach(pre => {
    if (pre.parentNode.classList.contains('code-wrapper')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'code-wrapper';
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', () => {
      const code = pre.textContent;
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
      }).catch(() => {
        btn.textContent = 'Failed';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      });
    });
    wrapper.appendChild(btn);
  });
}

function setupImageLightbox() {
  document.querySelectorAll('#page-content img:not(.no-zoom)').forEach(img => {
    if (img.closest('.link-card-icon') || img.closest('.file-video') || img.closest('.embed-image')) return;
    img.classList.add('zoomable');
    img.addEventListener('click', () => {
      const overlay = document.createElement('div');
      overlay.className = 'lightbox-overlay';
      const clone = document.createElement('img');
      clone.src = img.src;
      clone.alt = img.alt;
      overlay.appendChild(clone);
      overlay.addEventListener('click', () => overlay.remove());
      overlay.addEventListener('wheel', () => overlay.remove(), { passive: true });
      document.body.appendChild(overlay);
    });
  });
}

function addFeedbackWidget() {
  const existing = document.querySelector('.page-feedback');
  if (existing) existing.remove();
  const nav = document.querySelector('.page-nav');
  if (!nav) return;
  const feedback = document.createElement('div');
  feedback.className = 'page-feedback';
  feedback.innerHTML = '<span class="feedback-label">Was this helpful?</span>' +
    '<button class="feedback-btn" data-feedback="yes">&#128077;</button>' +
    '<button class="feedback-btn" data-feedback="no">&#128078;</button>';
  feedback.querySelectorAll('.feedback-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      feedback.querySelectorAll('.feedback-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
  nav.parentNode.insertBefore(feedback, nav.nextSibling);
}

function toggleDarkMode() {
  const html = document.documentElement;
  const isDark = html.classList.toggle('dark');
  localStorage.setItem('moe-dark-mode', isDark ? 'dark' : 'light');
  document.getElementById('dark-toggle').textContent = isDark ? '\u2600' : '\u263E';
}

function applyDarkMode() {
  const saved = localStorage.getItem('moe-dark-mode');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = saved ? saved === 'dark' : prefersDark;
  if (isDark) {
    document.documentElement.classList.add('dark');
    document.getElementById('dark-toggle').textContent = '\u2600';
  } else {
    document.getElementById('dark-toggle').textContent = '\u263E';
  }
}

/* ── Skeleton Loading ── */
function showSkeleton(container) {
  container.innerHTML = `
    <div class="skeleton skeleton-title"></div>
    <div class="skeleton skeleton-text"></div>
    <div class="skeleton skeleton-text"></div>
    <div class="skeleton skeleton-text skeleton-text--short"></div>
    <div class="skeleton skeleton-text"></div>
    <div class="skeleton skeleton-code"></div>
    <div class="skeleton skeleton-text"></div>
    <div class="skeleton skeleton-text skeleton-text--short"></div>
  `;
}

/* ── Edit Link ── */
function getEditUrl(pageUrl) {
  const relativePath = pageUrl
    .replace('https://open-mainframe-project.gitbook.io/mainframe-open-education-project/', '')
    .replace(/\.md$/, '.md');
  return `${GITHUB_BASE}/${relativePath}`;
}

/* ── Font Size Controls ── */
function changeFontSize(delta) {
  const el = document.getElementById('page-content');
  let size = parseFloat(localStorage.getItem('moe-font-size') || '16');
  size = Math.min(Math.max(size + delta, 12), 24);
  localStorage.setItem('moe-font-size', String(size));
  el.style.fontSize = size + 'px';
  const label = document.getElementById('font-size-label');
  if (label) label.textContent = size + 'px';
}

function applyFontSize() {
  const saved = parseFloat(localStorage.getItem('moe-font-size') || '16');
  document.getElementById('page-content').style.fontSize = saved + 'px';
  const label = document.getElementById('font-size-label');
  if (label) label.textContent = saved + 'px';
}

/* ── Command Palette ── */
function openCommandPalette() {
  const overlay = document.getElementById('cmd-palette');
  const input = document.getElementById('cmd-input');
  overlay.classList.add('open');
  input.value = '';
  input.focus();
  filterCommandPalette('');
}

function closeCommandPalette() {
  document.getElementById('cmd-palette').classList.remove('open');
}

function filterCommandPalette(query) {
  const list = document.getElementById('cmd-results');
  const q = query.toLowerCase().trim();
  const flat = flattenSitemap(sitemapData);
  let results = flat;
  if (q) {
    results = flat.filter(n => n.title.toLowerCase().includes(q));
  }
  if (results.length === 0) {
    list.innerHTML = '<div class="cmd-empty">No results found</div>';
    return;
  }
  list.innerHTML = results.map((n, i) => `
    <div class="cmd-result${i === 0 ? ' cmd-selected' : ''}" data-url="${escapeHtml(n.url)}" data-index="${i}">
      <span class="cmd-result-title">${escapeHtml(n.title)}</span>
    </div>
  `).join('');
  list.querySelectorAll('.cmd-result').forEach(el => {
    el.addEventListener('click', () => {
      const url = el.dataset.url;
      const node = findNodeByUrl(sitemapData, url);
      if (node) { closeCommandPalette(); loadPage(node); }
    });
    el.addEventListener('mouseenter', () => {
      list.querySelectorAll('.cmd-selected').forEach(s => s.classList.remove('cmd-selected'));
      el.classList.add('cmd-selected');
    });
  });
  list._selectedIndex = 0;
}

function navigateCommandPalette(direction) {
  const items = document.querySelectorAll('.cmd-result');
  if (!items.length) return;
  let idx = Array.from(items).findIndex(el => el.classList.contains('cmd-selected'));
  items[idx]?.classList.remove('cmd-selected');
  idx = Math.min(Math.max(idx + direction, 0), items.length - 1);
  items[idx].classList.add('cmd-selected');
  items[idx].scrollIntoView({ block: 'nearest' });
}

function commitCommandPalette() {
  const selected = document.querySelector('.cmd-result.cmd-selected');
  if (selected) {
    const url = selected.dataset.url;
    const node = findNodeByUrl(sitemapData, url);
    if (node) { closeCommandPalette(); loadPage(node); }
  }
}

/* ── Prefetch ── */
function setupPrefetch() {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const link = entry.target;
        const url = link.dataset?.url || link.getAttribute('href');
        if (url && url.includes('gitbook.io')) {
          const prefetchLink = document.createElement('link');
          prefetchLink.rel = 'prefetch';
          prefetchLink.href = `/api/page?url=${encodeURIComponent(url)}`;
          document.head.appendChild(prefetchLink);
        }
        observer.unobserve(link);
      }
    }
  }, { rootMargin: '200px' });

  document.querySelectorAll('.lesson-step, .page-nav-link, .welcome-card').forEach(el => observer.observe(el));
}

function triggerFadeIn(el) {
  el.classList.remove('fade-in');
  void el.offsetWidth;
  el.classList.add('fade-in');
}

async function loadPage(node) {
  const contentEl = document.getElementById('page-content');
  const sandboxContainer = document.getElementById('sandbox-container');
  if (currentMode === 'sandbox') {
    currentMode = 'auto';
    hideSandbox();
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'auto'));
  }
  if (sandboxContainer.style.display !== 'none' && sandboxContainer.style.display !== '') {
    hideSandbox();
  }
  if (node.url === WELCOME_URL) {
    currentUrl = null;
    currentTitle = '';
    showWelcome(node.title);
    setupScrollCompletion(node.url);
    if (window.innerWidth <= 768) closeSidebar();
    return;
  }
  showSkeleton(contentEl);
  contentEl.className = '';
  currentUrl = node.url;
  currentTitle = node.title;
  try {
    const effectiveMode = currentMode === 'auto' ? 'markdown' : currentMode;
    const result = await fetchPageContent(node.url, effectiveMode);
    if (effectiveMode === 'raw') {
      contentEl.className = 'raw-mode';
      contentEl.innerHTML = `<h1>${escapeHtml(node.title)}</h1>\n`;
      const textarea = document.createElement('textarea');
      textarea.style.cssText = 'width:100%;min-height:80vh;border:none;background:transparent;font:inherit;resize:none;outline:none';
      textarea.readOnly = true;
      textarea.value = result.content;
      contentEl.appendChild(textarea);
    } else {
      contentEl.innerHTML = `<h1>${escapeHtml(node.title)}</h1>\n` + result.content;
    }
    const quizEl = renderQuiz(node.url);
    if (quizEl) contentEl.appendChild(quizEl);
    renderPageToc(result.headings);
    updateReadTime();
    addInlineSandbox(contentEl, result.content);
    const navHtml = renderPageNav(node.url);
    if (navHtml) contentEl.insertAdjacentHTML('beforeend', navHtml);
    addPageMeta(node.url);
    addEditLink(node.url);
    addFeedbackWidget();
    addCopyButtons();
    setupImageLightbox();
    updateBreadcrumb(node.url);
    setActiveNavItem(node.url);
    updateSidebarCheckmarks();
    updateProgressUI();
    setupScrollCompletion(node.url);
    applyFontSize();
    triggerFadeIn(contentEl);
    document.title = `${node.title} - MOE Documentation`;
    resetContentScroll();
    if (window.innerWidth <= 768) closeSidebar();
  } catch (err) {
    contentEl.className = '';
    contentEl.innerHTML = `<div class="error">Failed to load page: ${escapeHtml(err.message)}</div>`;
  }
}

function addPageMeta(url) {
  const existing = document.querySelector('.page-meta');
  if (existing) existing.remove();
  const contentEl = document.getElementById('page-content');
  const firstH1 = contentEl.querySelector('h1');
  if (!firstH1) return;
  const meta = document.createElement('div');
  meta.className = 'page-meta';
  const done = isQuizCompleted(url);
  if (done) {
    const label = isQuizPage(url) ? 'Quiz passed' : 'Completed';
    meta.innerHTML = `<span class="page-meta-status completed">&#10003; ${label}</span>`;
  }
  firstH1.after(meta);
}

function addEditLink(url) {
  const existing = document.querySelector('.page-edit-link');
  if (existing) existing.remove();
  const contentEl = document.getElementById('page-content');
  const lastChild = contentEl.lastElementChild;
  if (!lastChild) return;
  const editUrl = getEditUrl(url);
  const link = document.createElement('div');
  link.className = 'page-edit-link';
  link.innerHTML = `<a href="${escapeHtml(editUrl)}" target="_blank" rel="noopener">&#9998; Suggest a change on GitHub</a>`;
  contentEl.appendChild(link);
}

function setViewMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  if (mode === 'sandbox') { showSandbox(); return; }
  hideSandbox();
  if (currentUrl) {
    const node = findNodeByUrl(sitemapData, currentUrl);
    if (node) loadPage(node);
  }
}

function performSearch(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('.chapter-module').forEach(mod => {
    if (!q) {
      mod.style.display = '';
      mod.classList.remove('open');
      mod.querySelectorAll('.lesson-step').forEach(s => { s.style.display = ''; });
      return;
    }
    let anyMatch = false;
    mod.querySelectorAll('.lesson-step').forEach(step => {
      const title = step.dataset.title || '';
      const match = title.toLowerCase().includes(q);
      step.style.display = match ? '' : 'none';
      if (match) anyMatch = true;
    });
    const titleMatch = (mod.querySelector('.chapter-title')?.textContent || '').toLowerCase().includes(q);
    mod.style.display = (titleMatch || anyMatch) ? '' : 'none';
    if (anyMatch) mod.classList.add('open');
  });
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('app').classList.remove('sidebar-open');
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const app = document.getElementById('app');
  const isOpen = sidebar.classList.toggle('open');
  app.classList.toggle('sidebar-open', isOpen);
}

function showSandbox() {
  document.getElementById('page-content').style.display = 'none';
  document.getElementById('content-toolbar').style.display = 'none';
  const container = document.getElementById('sandbox-container');
  container.style.display = 'flex';
  container.classList.add('visible');
}

function hideSandbox() {
  document.getElementById('sandbox-container').style.display = 'none';
  document.getElementById('sandbox-container').classList.remove('visible');
  document.getElementById('page-content').style.display = '';
  document.getElementById('content-toolbar').style.display = '';
}

function setSandboxOutput(html, className) {
  const output = document.getElementById('sandbox-output');
  output.innerHTML = html;
  output.className = 'sandbox-output' + (className ? ' ' + className : '');
}

function showSandboxSkeleton() {
  const output = document.getElementById('sandbox-output');
  output.className = 'sandbox-output';
  output.innerHTML = `<div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div>`;
}

async function runSandboxCode() {
  const editor = document.getElementById('sandbox-editor');
  const lang = document.getElementById('sandbox-lang').value;
  const code = editor.value;
  const runBtn = document.getElementById('sandbox-run');
  if (!code.trim()) {
    setSandboxOutput('<span class="output-error">Please enter some code to execute.</span>');
    return;
  }
  runBtn.disabled = true;
  showSandboxSkeleton();
  try {
    const res = await fetch('/api/sandbox/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: lang, code })
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.error || data.message || `Server returned ${res.status}`;
      setSandboxOutput(`<span class="output-error">${escapeHtml(msg)}</span>`);
      return;
    }
    let html = '';
    if (data.run && data.run.stdout) html += '<span class="output-stdout">' + escapeHtml(data.run.stdout) + '</span>';
    if (data.run && data.run.stderr) html += '<span class="output-stderr">' + escapeHtml(data.run.stderr) + '</span>';
    if (data.compile && data.compile.stderr) html += '<span class="output-stderr">Compiler stderr:\n' + escapeHtml(data.compile.stderr) + '</span>';
    if (data.run && data.run.signal) html += '<span class="output-error">Process terminated by signal: ' + escapeHtml(data.run.signal) + '</span>';
    if (!html) {
      if (data.run && data.run.output) {
        html = '<span class="output-stdout">' + escapeHtml(data.run.output) + '</span>';
      } else {
        html = '<span class="output-success">Code executed successfully (no output).</span>';
      }
    }
    setSandboxOutput(html);
  } catch (err) {
    if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      setSandboxOutput('<span class="output-error">Sandbox is not reachable. Make sure the GnuCOBOL sandbox is running on port 4000.</span>');
    } else if (err.name === 'AbortError' || err.message.includes('timeout')) {
      setSandboxOutput('<span class="output-error">Execution timed out. The code may contain an infinite loop or long-running operation.</span>');
    } else {
      setSandboxOutput('<span class="output-error">Unexpected error: ' + escapeHtml(err.message) + '</span>');
    }
  } finally {
    runBtn.disabled = false;
  }
}

function hasCobolContent(content) {
  if (!content) return false;
  const text = content.replace(/<[^>]+>/g, ' ').toLowerCase();
  return text.includes('cobol');
}

function addInlineSandbox(contentEl, contentText) {
  if (!hasCobolContent(contentText)) return;
  if (contentEl.querySelector('.inline-sandbox')) return;
  const section = document.createElement('div');
  section.className = 'inline-sandbox';
  section.innerHTML = `<h2 class="inline-sandbox-heading">COBOL Sandbox</h2>
<p class="inline-sandbox-desc">Try writing and running COBOL code right here.</p>
<div class="inline-sandbox-editor-wrapper">
  <textarea class="inline-sandbox-editor" spellcheck="false" placeholder="Write your COBOL code here...">       IDENTIFICATION DIVISION.
       PROGRAM-ID. HELLO.
       PROCEDURE DIVISION.
           DISPLAY "Hello from COBOL".
           STOP RUN.</textarea>
</div>
<div class="inline-sandbox-controls">
  <button class="inline-sandbox-run">Run</button>
  <span class="inline-sandbox-status"></span>
</div>
<div class="inline-sandbox-output"></div>`;
  const runBtn = section.querySelector('.inline-sandbox-run');
  const editor = section.querySelector('.inline-sandbox-editor');
  const output = section.querySelector('.inline-sandbox-output');
  const status = section.querySelector('.inline-sandbox-status');
  runBtn.addEventListener('click', async () => {
    const code = editor.value;
    if (!code.trim()) {
      output.className = 'inline-sandbox-output visible';
      output.innerHTML = '<span class="output-error">Please enter some code.</span>';
      return;
    }
    runBtn.disabled = true;
    status.textContent = 'Running...';
    output.className = 'inline-sandbox-output visible';
    output.innerHTML = `<div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div>`;
    try {
      const res = await fetch('/api/sandbox/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'cobol', code })
      });
      const data = await res.json();
      if (!res.ok) {
        output.innerHTML = '<span class="output-error">' + escapeHtml(data.error || data.message || 'Server error') + '</span>';
        return;
      }
      let html = '';
      if (data.run && data.run.stdout) html += '<span class="output-stdout">' + escapeHtml(data.run.stdout) + '</span>';
      if (data.run && data.run.stderr) html += '<span class="output-stderr">' + escapeHtml(data.run.stderr) + '</span>';
      if (data.compile && data.compile.stderr) html += '<span class="output-stderr">Compiler stderr:\n' + escapeHtml(data.compile.stderr) + '</span>';
      if (data.run && data.run.signal) html += '<span class="output-error">Terminated by signal: ' + escapeHtml(data.run.signal) + '</span>';
      if (!html) {
        html = data.run && data.run.output
          ? '<span class="output-stdout">' + escapeHtml(data.run.output) + '</span>'
          : '<span class="output-success">Code executed successfully (no output).</span>';
      }
      output.innerHTML = html;
    } catch (err) {
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        output.innerHTML = '<span class="output-error">Sandbox not reachable. Make sure the GnuCOBOL sandbox is running on port 4000.</span>';
      } else {
        output.innerHTML = '<span class="output-error">Error: ' + escapeHtml(err.message) + '</span>';
      }
    } finally {
      runBtn.disabled = false;
      status.textContent = '';
    }
  });
  contentEl.appendChild(section);
}

function setupTocScrollTracking() {
  if (tocScrollObserver) {
    tocScrollObserver.disconnect();
    tocScrollObserver = null;
  }
  const tocItems = document.querySelectorAll('.toc-item');
  if (!tocItems.length) return;
  const headings = [];
  tocItems.forEach(item => {
    const id = item.dataset.tocId;
    const el = document.getElementById(id);
    if (el) headings.push({ el, item });
  });
  if (!headings.length) return;
  tocScrollObserver = new IntersectionObserver((entries) => {
    let active = null;
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const found = headings.find(h => h.el === entry.target);
        if (found && (!active || entry.boundingClientRect.top < active.boundingClientRect.top)) {
          active = entry.target;
        }
      }
    }
    if (active) {
      tocItems.forEach(i => i.classList.remove('active'));
      const found = headings.find(h => h.el === active);
      if (found) found.item.classList.add('active');
    }
  }, { rootMargin: '-80px 0px -60% 0px' });
  headings.forEach(h => tocScrollObserver.observe(h.el));
}

/* ── Journey Map ── */
const TERRAIN_URLS = [
  'https://open-mainframe-project.gitbook.io/mainframe-open-education-project/introduction-what-is-enterprise-computing.md',
  'https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-1-what-is-a-mainframe-today.md',
  'https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-2-mainframe-101-foundational-technology.md',
  'https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-3-roles-in-mainframe.md',
  'https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-4-deeper-dive-in-role-chosen.md',
  'https://open-mainframe-project.gitbook.io/mainframe-open-education-project/chapter-5-career-paths-and-opportunities.md',
];

function setupJourneyMap() {
  document.querySelectorAll('.terrain-card').forEach((card, i) => {
    card.addEventListener('click', () => {
      const url = TERRAIN_URLS[i];
      if (url && sitemapData) {
        const target = findNodeByUrl(sitemapData, url);
        if (target) dismissJourney(target.url);
      }
    });
  });
  document.querySelectorAll('.terrain-marker-g').forEach((g, i) => {
    g.addEventListener('click', () => {
      const url = TERRAIN_URLS[i];
      if (url && sitemapData) {
        const target = findNodeByUrl(sitemapData, url);
        if (target) dismissJourney(target.url);
      }
    });
  });
}

/* ── Splash ── */
function dismissSplash() {
  const splash = document.getElementById('splash');
  if (!splash || splash.classList.contains('dismissed')) return;
  splash.classList.add('dismissed');
  /* Hide main content immediately so it doesn't show through fading overlay */
  const app = document.getElementById('app');
  const header = document.getElementById('top-header');
  if (app) app.style.display = 'none';
  if (header) header.style.display = 'none';
  setTimeout(() => {
    splash.style.display = 'none';
    const journey = document.getElementById('journey');
    if (journey) journey.classList.add('visible');
  }, 600);
}

async function dismissJourney(targetUrl) {
  const journey = document.getElementById('journey');
  if (!journey || journey.classList.contains('dismissed')) return;
  journey.classList.remove('visible');
  journey.classList.add('dismissed');
  const fade = new Promise(r => setTimeout(r, 600));
  let load = Promise.resolve();
  if (targetUrl && sitemapData) {
    const node = findNodeByUrl(sitemapData, targetUrl);
    if (node) load = loadPage(node);
  }
  await Promise.all([fade, load]);
  journey.style.display = 'none';
  const app = document.getElementById('app');
  const header = document.getElementById('top-header');
  if (app) app.style.display = 'flex';
  if (header) header.style.display = 'flex';
}

/* ── Init ── */
async function init() {
  try {
    /* Account system: wait for auth state, then pull server progress into
       local storage so a logged-in user's progress reflects across devices. */
    if (window.MOE_AUTH) {
      try { await MOE_AUTH.init(); } catch (e) { /* offline auth is non-fatal */ }
      MOE_AUTH.renderAccountButton('auth-container');
      await MOE_AUTH.mergeProgress();
      document.addEventListener('moe:auth-changed', async () => {
        MOE_AUTH.renderAccountButton('auth-container');
        await MOE_AUTH.mergeProgress();
        updateProgressUI();
        updateSidebarCheckmarks();
      });
    }

    const welcomeEl = document.querySelector('.welcome');
    if (welcomeEl) welcomeHtml = welcomeEl.outerHTML;

    sitemapData = await fetchSitemap();
    buildChapterSidebar(sitemapData, document.getElementById('nav-tree'));
    await loadQuizzes();
    applyDarkMode();
    updateProgressUI();
    updateSidebarCheckmarks();

    document.getElementById('dark-toggle').addEventListener('click', toggleDarkMode);
    document.getElementById('sandbox-btn').addEventListener('click', () => setViewMode('sandbox'));

    /* Font size controls */
    document.getElementById('font-dec')?.addEventListener('click', () => changeFontSize(-1));
    document.getElementById('font-inc')?.addEventListener('click', () => changeFontSize(1));
    applyFontSize();

    document.getElementById('splash')?.addEventListener('click', dismissSplash);

    setupJourneyMap();

    document.getElementById('journey-start')?.addEventListener('click', () => dismissJourney());

    document.getElementById('page-content').addEventListener('click', (e) => {
      const navLink = e.target.closest('.page-nav-link');
      if (navLink) {
        e.preventDefault();
        const url = navLink.dataset.url;
        const node = findNodeByUrl(sitemapData, url);
        if (node) loadPage(node);
        return;
      }
      const card = e.target.closest('.welcome-card');
      if (card && card.getAttribute('href') && card.getAttribute('href') !== '#') {
        e.preventDefault();
        const url = card.getAttribute('href');
        const node = findNodeByUrl(sitemapData, url);
        if (node) loadPage(node);
      }
      const quickBtn = e.target.closest('[data-action]');
      if (quickBtn) {
        e.preventDefault();
        const target = quickBtn.dataset.action === 'start'
          ? getFirstLesson()
          : getFirstIncompleteLesson() || getFirstLesson();
        if (target) {
          const node = findNodeByUrl(sitemapData, target.url);
          if (node) loadPage(node);
        }
      }
    });

    document.getElementById('search-input').addEventListener('input', (e) => {
      performSearch(e.target.value);
    });

    document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);

    document.getElementById('page-toc').addEventListener('click', (e) => {
      const item = e.target.closest('.toc-item');
      if (item) {
        e.preventDefault();
        const id = item.dataset.tocId;
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => setViewMode(btn.dataset.mode));
    });

    document.getElementById('sandbox-run').addEventListener('click', runSandboxCode);

    document.getElementById('sandbox-editor').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runSandboxCode();
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = e.target.selectionStart;
        const end = e.target.selectionEnd;
        e.target.value = e.target.value.substring(0, start) + '  ' + e.target.value.substring(end);
        e.target.selectionStart = e.target.selectionEnd = start + 2;
      }
    });

    /* Quiz keyboard navigation */
    document.getElementById('page-content').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const quizSubmit = e.target.closest('.quiz-form')?.querySelector('.quiz-submit');
        if (quizSubmit && quizSubmit.style.display !== 'none') {
          const option = e.target.closest('.quiz-option');
          if (option && option.querySelector('input')) {
            return;
          }
        }
      }
    });

    let scrollTimeout;
    document.getElementById('content-area').addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(setupTocScrollTracking, 200);
    }, { passive: true });

    const pageContent = document.getElementById('page-content');
    const tocObserver = new MutationObserver(() => {
      setupTocScrollTracking();
    });
    tocObserver.observe(pageContent, { childList: true, subtree: true });

    /* Keyboard scrolling for the locked content column */
    const contentArea = document.getElementById('content-area');
    document.addEventListener('keydown', (e) => {
      const el = document.activeElement;
      const tag = el && el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A' || el?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!contentArea) return;
      let delta = 0;
      if (e.key === ' ') delta = Math.round(contentArea.clientHeight * 0.9);
      else if (e.key === 'PageDown') delta = contentArea.clientHeight;
      else if (e.key === 'PageUp') delta = -contentArea.clientHeight;
      else if (e.key === 'Home') { contentArea.scrollTop = 0; return; }
      else if (e.key === 'End') { contentArea.scrollTop = contentArea.scrollHeight; return; }
      else return;
      e.preventDefault();
      contentArea.scrollTop += delta;
    });

    document.addEventListener('click', (e) => {
      if (window.innerWidth <= 768) {
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('sidebar-toggle');
        if (!sidebar.contains(e.target) && !toggle.contains(e.target)) {
          closeSidebar();
        }
      }
    });

    /* Command palette */
    const cmdPalette = document.getElementById('cmd-palette');
    const cmdInput = document.getElementById('cmd-input');

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (cmdPalette.classList.contains('open')) {
          closeCommandPalette();
        } else {
          openCommandPalette();
        }
      }
      if (e.key === 'Escape' && cmdPalette.classList.contains('open')) {
        closeCommandPalette();
      }
    });

    cmdInput?.addEventListener('input', (e) => filterCommandPalette(e.target.value));

    cmdInput?.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); navigateCommandPalette(1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); navigateCommandPalette(-1); }
      if (e.key === 'Enter') { e.preventDefault(); commitCommandPalette(); }
    });

    cmdPalette?.addEventListener('click', (e) => {
      if (e.target === cmdPalette) closeCommandPalette();
    });

    /* Prefetch sidebar links */
    setupPrefetch();

    /* Navigate to a specific page if ?goto= param is present */
    const params = new URLSearchParams(window.location.search);
    const gotoUrl = params.get('goto');
    if (gotoUrl) {
      const node = findNodeByUrl(sitemapData, gotoUrl);
      if (node) {
        const splash = document.getElementById('splash');
        const journey = document.getElementById('journey');
        if (splash) { splash.style.display = 'none'; splash.classList.add('dismissed'); }
        if (journey) { journey.style.display = 'none'; journey.classList.add('dismissed'); }
        setTimeout(() => loadPage(node), 100);
      }
    } else {
      ensureWelcomeCompleted();
      setupScrollCompletion(WELCOME_URL);
    }

    /* Landing page search arrives via ?q= — filter the sidebar */
    const searchQuery = params.get('q');
    if (searchQuery) {
      const searchInput = document.getElementById('search-input');
      if (searchInput) {
        searchInput.value = searchQuery;
        performSearch(searchQuery);
        if (window.innerWidth <= 768) toggleSidebar();
      }
    }

  } catch (err) {
    console.error('Failed to initialize:', err);
    document.getElementById('page-content').innerHTML =
      `<div class="error">Failed to load sitemap. Make sure the server is running.</div>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
