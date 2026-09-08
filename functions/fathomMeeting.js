// functions/fathomMeeting.js
// Fathom "new meeting content ready" webhook: signature verification and
// payload normalization. Ported from the equivalent (already-shipped, but
// currently inactive) module in Pulse-UI---Goal-Tracking-Bot, adapted to
// BOM-Tracker's own field names. Deliberately does not carry a transcript
// field — only the share link, summary and action items are stored.
const crypto = require('node:crypto');

/**
 * Verify a Svix webhook signature.
 * @param {object} opts
 * @param {string} opts.id - `webhook-id` header
 * @param {string} opts.timestamp - `webhook-timestamp` header (unix seconds)
 * @param {string} opts.signatureHeader - `webhook-signature` header (`v1,<sig>`, space-delimited if several)
 * @param {string} opts.rawBody - the exact raw request body string
 * @param {string} opts.secret - the `whsec_...` signing secret
 * @param {number} [opts.toleranceSec=300] - max clock skew before rejecting
 * @param {number} [opts.nowSec] - override current time (for tests)
 * @returns {boolean}
 */
function verifySvixSignature({ id, timestamp, signatureHeader, rawBody, secret, toleranceSec = 300, nowSec }) {
  if (!id || !timestamp || !signatureHeader || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Number.isFinite(nowSec) ? nowSec : Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > toleranceSec) return false;

  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', key).update(signedContent, 'utf8').digest('base64');
  const expectedBuf = Buffer.from(expected);

  for (const part of String(signatureHeader).split(' ')) {
    const comma = part.indexOf(',');
    if (comma < 0) continue;
    const version = part.slice(0, comma);
    const sig = part.slice(comma + 1);
    if (version !== 'v1' || !sig) continue;
    const sigBuf = Buffer.from(sig);
    if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

/** Build the Svix `v1,<sig>` signature for a body (test helper; mirrors the sender). */
function computeSvixSignature({ id, timestamp, rawBody, secret }) {
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  return 'v1,' + crypto.createHmac('sha256', key).update(signedContent, 'utf8').digest('base64');
}

/**
 * Normalize a Fathom "new meeting content ready" webhook body into BOM-Tracker's
 * internal shape. No transcript field — only what's needed to display and match.
 */
function normalizeFathomPayload(body) {
  const b = body || {};
  const invitees = Array.isArray(b.calendar_invitees) ? b.calendar_invitees : [];
  return {
    fathomRecordingId: b.recording_id != null ? String(b.recording_id) : '',
    title: b.title || b.meeting_title || '',
    shareUrl: b.share_url || b.url || '',
    startedAt: b.recording_start_time || b.scheduled_start_time || '',
    endedAt: b.recording_end_time || b.scheduled_end_time || '',
    hostEmail: (b.recorded_by && b.recorded_by.email) || '',
    attendees: invitees.map((i) => ({ email: i.email || '', name: i.name || '' })),
    summary: (b.default_summary && b.default_summary.markdown_formatted) || b.summary || '',
    actionItems: Array.isArray(b.action_items) ? b.action_items : [],
  };
}

/**
 * Union the project ids matched by a set of attendee emails against a
 * lowercased-email -> projectIds[] lookup (the shape of the `stakeholderIndex`
 * collection). Pure — the Firestore reads that build `emailToProjectIds`
 * happen in index.js.
 */
function collectMatchedProjectIds(attendeeEmails, emailToProjectIds) {
  const matched = new Set();
  for (const email of attendeeEmails || []) {
    const key = String(email || '').toLowerCase().trim();
    if (!key) continue;
    const ids = emailToProjectIds[key] || [];
    for (const id of ids) matched.add(id);
  }
  return [...matched];
}

/** Lowercased, deduped set of a project's own stakeholder emails (members + externalRecipients). */
function extractStakeholderEmails(projectData) {
  const emails = new Set();
  for (const m of (projectData && projectData.members) || []) {
    if (m && m.email) emails.add(String(m.email).toLowerCase().trim());
  }
  for (const r of (projectData && projectData.externalRecipients) || []) {
    if (r && r.email) emails.add(String(r.email).toLowerCase().trim());
  }
  return emails;
}

/**
 * Lowercased, deduped set of a client's active CRM contact emails
 * (`Client.contacts`, the same list Support tickets already resolve
 * `reportedByContactId` against). Inactive contacts are excluded, matching
 * `getClientContacts`'s default in src/utils/settingsFirestore.ts.
 */
function extractClientContactEmails(clientData) {
  const emails = new Set();
  for (const c of (clientData && clientData.contacts) || []) {
    if (c && c.email && c.isActive !== false) {
      emails.add(String(c.email).toLowerCase().trim());
    }
  }
  return emails;
}

/**
 * The full stakeholder email set a project should match meetings against:
 * its own members/externalRecipients, plus every active CRM contact of its
 * client (so a contact added once in the client CRM is automatically a
 * stakeholder on every project for that client — no per-project re-entry).
 */
function computeProjectStakeholderEmails(projectData, clientData) {
  const emails = extractStakeholderEmails(projectData);
  for (const email of extractClientContactEmails(clientData)) {
    emails.add(email);
  }
  return emails;
}

/** Diff two lowercased email sets, for applying targeted stakeholderIndex updates. */
function diffEmailSets(beforeEmails, afterEmails) {
  const added = [...afterEmails].filter((e) => !beforeEmails.has(e));
  const removed = [...beforeEmails].filter((e) => !afterEmails.has(e));
  return { added, removed };
}

/**
 * Diff two project docs' OWN stakeholder email sets (before/after a write).
 * Does not account for client CRM contacts — callers syncing the full
 * picture should use computeProjectStakeholderEmails + diffEmailSets instead.
 */
function diffStakeholderEmails(beforeData, afterData) {
  return diffEmailSets(extractStakeholderEmails(beforeData), extractStakeholderEmails(afterData));
}

module.exports = {
  verifySvixSignature,
  computeSvixSignature,
  normalizeFathomPayload,
  collectMatchedProjectIds,
  extractStakeholderEmails,
  extractClientContactEmails,
  computeProjectStakeholderEmails,
  diffEmailSets,
  diffStakeholderEmails,
};
