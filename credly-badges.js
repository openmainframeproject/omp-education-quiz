/**
 * Credly Badges API Module
 * Real Credly badge issuance for the Mainframe Open Education Practitioner certification.
 *
 * Environment variables:
 * - CREDLY_API_BASE: Base API URL (default: 'https://api.credly.com/v1', or sandbox 'https://sandbox-api.credly.com/v1')
 * - CREDLY_ORG_ID: Organization ID from Credly admin panel
 * - CREDLY_AUTH_TOKEN: Authorization token from Credly admin panel (Developers)
 * - CREDLY_BADGE_TEMPLATE_ID: Badge template ID for MOE Practitioner badge
 */

const { config } = require('./config');

const CREDLY_API_BASE = config.credly.apiBase;
const CREDLY_ORG_ID = config.credly.orgId;
const CREDLY_AUTH_TOKEN = config.credly.authToken;
const CREDLY_BADGE_TEMPLATE_ID = config.credly.badgeTemplateId;

/**
 * Builds HTTP Basic Auth header for Credly API.
 * Credly uses the authorization_token as username with an empty password.
 */
function credlyAuthHeader() {
  if (!CREDLY_AUTH_TOKEN) return '';
  const encoded = Buffer.from(`${CREDLY_AUTH_TOKEN}:`).toString('base64');
  return `Basic ${encoded}`;
}

/**
 * Issues a badge to a recipient on Credly.
 *
 * @param {Object} params
 * @param {string} params.email - Recipient email address
 * @param {string} params.firstName - Recipient first name
 * @param {string} params.lastName - Recipient last name
 * @param {number|string} params.userId - Internal user ID
 * @returns {Promise<{ credlyBadgeId: string, acceptBadgeUrl: string, badgeUrl: string, isMock?: boolean }>}
 */
async function issueBadge({ email, firstName, lastName, userId }) {
  // If Credly credentials are not configured in environment (e.g. dev/test mode),
  // generate a graceful simulation badge for local verification.
  if (!CREDLY_ORG_ID || !CREDLY_AUTH_TOKEN) {
    console.warn('[credly] CREDLY_ORG_ID or CREDLY_AUTH_TOKEN not configured. Generating simulated badge.');
    const mockId = `mock_badge_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    return {
      credlyBadgeId: mockId,
      acceptBadgeUrl: `https://www.credly.com/earner/earned/badge/${mockId}`,
      badgeUrl: `https://www.credly.com/badges/${mockId}`,
      isMock: true,
    };
  }

  const endpoint = `${CREDLY_API_BASE}/organizations/${CREDLY_ORG_ID}/badges`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: credlyAuthHeader(),
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; MOE-Viewer/1.0)',
      },
      body: JSON.stringify({
        recipient_email: email,
        badge_template_id: CREDLY_BADGE_TEMPLATE_ID,
        issued_at: new Date().toISOString(),
        issued_to_first_name: firstName,
        issued_to_last_name: lastName,
        issuer_earner_id: String(userId),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Credly issue failed: HTTP ${res.status} — ${body}`);
    }

    const payload = await res.json();
    const data = payload.data || payload;

    return {
      credlyBadgeId: data.id || data.badge_id,
      acceptBadgeUrl: data.accept_badge_url || `https://www.credly.com/earner/earned/badge/${data.id}`,
      badgeUrl: data.badge_url || `https://www.credly.com/badges/${data.id}`,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Credly API request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  issueBadge,
  CREDLY_BADGE_TEMPLATE_ID,
};
