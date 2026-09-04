/* ── MOE Account system (email + password) ────────────────────────────────
   Shared by viewer.html, certification.html (badge exam) and index.html.
   - Logged out  → progress kept in localStorage only.
   - Logged in   → progress is merged with and pushed to the server.        */

(function () {
  const COMPLETED_KEY = 'moe_completed_quizzes';

  function getLocalProgress() {
    try {
      const v = JSON.parse(localStorage.getItem(COMPLETED_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }

  function setLocalProgress(pages) {
    localStorage.setItem(COMPLETED_KEY, JSON.stringify(pages));
  }

  function unique(list) {
    return [...new Set(list.filter(Boolean))];
  }

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  async function fetchJSON(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  const MOE_AUTH = {
    user: null,

    async init() {
      const { data } = await fetchJSON('/api/auth/me');
      this.user = data.user || null;
      return this.user;
    },

    isLoggedIn() {
      return !!(this.user && this.user.email);
    },

    /* Merge server progress into local progress (union), then push back.
       Called on login / page init so a user resumes where they left off
       across devices while keeping any device-local completions. */
    async mergeProgress() {
      if (!this.isLoggedIn()) return;
      try {
        const { data } = await fetchJSON('/api/progress');
        const serverPages = Array.isArray(data.pages) ? data.pages : [];
        const merged = unique([...getLocalProgress(), ...serverPages]);
        setLocalProgress(merged);
        await postJSON('/api/progress/sync', { pages: merged });
        return merged;
      } catch (err) {
        console.warn('Progress sync failed:', err);
        return getLocalProgress();
      }
    },

    /* Record a page/quiz completion. Always writes locally; also pushes to
       the server when logged in. Fire-and-forget. */
    async report(pageUrl) {
      if (!pageUrl) return;
      const local = getLocalProgress();
      if (!local.includes(pageUrl)) {
        local.push(pageUrl);
        setLocalProgress(local);
      }
      if (this.isLoggedIn()) {
        try { await postJSON('/api/progress', { pageUrl }); } catch (err) {
          console.warn('Progress report failed:', err);
        }
      }
    },

    async register(email, password) {
      const { ok, status, data } = await postJSON('/api/auth/register', { email, password });
      if (ok) { this.user = data.user; return { ok: true, user: data.user }; }
      return { ok: false, error: data.error || 'Registration failed', status };
    },

    async login(email, password) {
      const { ok, status, data } = await postJSON('/api/auth/login', { email, password });
      if (ok) { this.user = data.user; return { ok: true, user: data.user }; }
      return { ok: false, error: data.error || 'Login failed', status };
    },

    async logout() {
      await postJSON('/api/auth/logout', {});
      this.user = null;
    },
  };

  /* ── Auth modal UI ────────────────────────────────────────────────────── */

  function openModal() {
    const modal = document.getElementById('auth-modal');
    if (!modal) return;
    modal.classList.add('open');
    const tab = modal.dataset.moeTab || 'login';
    switchTab(tab);
    const input = modal.querySelector('input[type="email"]');
    if (input) setTimeout(() => input.focus(), 50);
  }

  function closeModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.remove('open');
  }

  function switchTab(tab) {
    const modal = document.getElementById('auth-modal');
    if (!modal) return;
    modal.dataset.moeTab = tab;
    modal.querySelectorAll('.auth-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.authTab === tab);
    });
    modal.querySelectorAll('.auth-panel').forEach((p) => {
      p.classList.toggle('active', p.dataset.authPanel === tab);
    });
    const error = modal.querySelector('.auth-error');
    if (error) error.textContent = '';
  }

  function showError(msg) {
    const modal = document.getElementById('auth-modal');
    const error = modal && modal.querySelector('.auth-error');
    if (error) error.textContent = msg || '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const modal = document.getElementById('auth-modal');
    if (!modal) return;
    const tab = modal.dataset.moeTab || 'login';
    const form = modal.querySelector(`.auth-panel[data-auth-panel="${tab}"] form`);
    if (!form) return;
    const email = (form.querySelector('input[type="email"]') || {}).value || '';
    const password = (form.querySelector('input[type="password"]') || {}).value || '';
    const btn = form.querySelector('button[type="submit"]');
    showError('');
    if (btn) { btn.disabled = true; btn.textContent = 'Please wait…'; }
    try {
      const result = tab === 'register'
        ? await MOE_AUTH.register(email, password)
        : await MOE_AUTH.login(email, password);
      if (!result.ok) {
        showError(result.error || 'Something went wrong.');
        return;
      }
      await MOE_AUTH.mergeProgress();
      closeModal();
      document.dispatchEvent(new CustomEvent('moe:auth-changed', { detail: { user: MOE_AUTH.user } }));
    } catch (err) {
      showError('Network error. Please try again.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = tab === 'register' ? 'Create Account' : 'Log In'; }
    }
  }

  async function handleLogout() {
    await MOE_AUTH.logout();
    document.dispatchEvent(new CustomEvent('moe:auth-changed', { detail: { user: null } }));
  }

  /* Render the account button state. The container may be styled per page
     via the `auth-btn` class (customized in each page's CSS). */
  function renderAccountButton(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (MOE_AUTH.isLoggedIn()) {
      const initial = (MOE_AUTH.user.email || '?').charAt(0).toUpperCase();
      container.innerHTML = `
        <button type="button" class="auth-btn auth-btn-user" id="auth-user-btn"
                title="${MOE_AUTH.user.email}">${initial}
          <span class="auth-btn-email">${MOE_AUTH.user.email}</span>
        </button>
        <div class="auth-menu" id="auth-menu">
          <span class="auth-menu-email">${MOE_AUTH.user.email}</span>
          <button type="button" class="auth-menu-logout" id="auth-logout-btn">Log Out</button>
        </div>`;
      const userBtn = container.querySelector('#auth-user-btn');
      const menu = container.querySelector('#auth-menu');
      const logout = container.querySelector('#auth-logout-btn');
      if (userBtn && menu) {
        userBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.classList.toggle('open');
        });
        document.addEventListener('click', (e) => {
          if (!container.contains(e.target)) menu.classList.remove('open');
        });
      }
      if (logout) logout.addEventListener('click', handleLogout);
    } else {
      container.innerHTML = `
        <button type="button" class="auth-btn" id="auth-open-btn">Log In</button>`;
      const openBtn = container.querySelector('#auth-open-btn');
      if (openBtn) openBtn.addEventListener('click', openModal);
    }
  }

  function bindModalEvents() {
    const modal = document.getElementById('auth-modal');
    if (!modal) return;
    const closeBtn = modal.querySelector('.auth-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
    });
    modal.querySelectorAll('.auth-tab').forEach((t) => {
      t.addEventListener('click', () => switchTab(t.dataset.authTab));
    });
    modal.querySelectorAll('.auth-panel form').forEach((form) => {
      form.addEventListener('submit', handleSubmit);
    });
  }

  MOE_AUTH.openModal = openModal;
  MOE_AUTH.closeModal = closeModal;
  MOE_AUTH.renderAccountButton = renderAccountButton;
  MOE_AUTH.bindModalEvents = bindModalEvents;

  /* Auto-init on DOM ready. Pages call MOE_AUTH.renderAccountButton() after
     init() if they have an account container. */
  function boot() {
    bindModalEvents();
    MOE_AUTH.init().then(() => {
      document.dispatchEvent(new CustomEvent('moe:auth-ready', { detail: { user: MOE_AUTH.user } }));
    }).catch(() => {
      document.dispatchEvent(new CustomEvent('moe:auth-ready', { detail: { user: null } }));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.MOE_AUTH = MOE_AUTH;
})();
