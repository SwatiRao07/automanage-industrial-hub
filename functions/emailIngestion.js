// functions/emailIngestion.js
// Email capture: Gmail OAuth polling, capture-scope guard, message parsing,
// and Gemini-based sanitization. Domain-guard constants and address parsing
// are ported from Pulse-UI---Goal-Tracking-Bot/services/emailStakeholders.js
// (adapted field names) — see docs/superpowers/specs/2026-09-09-email-capture-design.md §2.

// Our own company domains. An address on one of these is never treated as an
// external stakeholder. Generic internal mailboxes (sales@, info@) getting
// mistaken for a real contact caused a real incident in the system this was
// ported from (2026-08 "Toyota Connected" mass-misattribution) — this guard
// is the direct mitigation: a purely internal thread never gets captured.
const INTERNAL_MAIL_DOMAINS = new Set(['qualitastech.com', 'datasensor.in']);

// Ported from Pulse for parity with the source guard's threat model; not
// currently load-bearing in BOM-Tracker's per-email (not per-domain) matching,
// but kept so a future domain-level heuristic doesn't have to rediscover it.
const PERSONAL_MAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
  'live.com', 'aol.com', 'rediffmail.com', 'protonmail.com',
]);

function getEmailDomain(email) {
  const value = String(email || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  return at >= 0 ? value.slice(at + 1) : null;
}

/** Parse a Gmail header address list ("From"/"To"/"Cc") into {name, email} entries. */
function parseAddressList(headerValue) {
  if (!headerValue) return [];
  const entries = [];
  let current = '';
  let inQuotes = false;
  let inAngle = false;

  for (const ch of String(headerValue)) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === '<') inAngle = true;
    if (ch === '>') inAngle = false;
    if ((ch === ',' || ch === ';') && !inQuotes && !inAngle) {
      if (current.trim()) entries.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) entries.push(current.trim());

  return entries
    .map((value) => {
      const match = value.match(/^"?(.+?)"?\s*<(.+?)>$/);
      return match
        ? { name: match[1].trim(), email: match[2].trim().toLowerCase() }
        : { name: '', email: value.replace(/^<|>$/g, '').trim().toLowerCase() };
    })
    .filter((item) => item.email.includes('@'));
}

function isInternalDomain(email) {
  const domain = getEmailDomain(email);
  return !!domain && INTERNAL_MAIL_DOMAINS.has(domain);
}

/** Capture-scope guard: at least one from/to/cc participant must be external. */
function hasExternalParticipant(participants) {
  return (participants || []).some((p) => p && p.email && !isInternalDomain(p.email));
}

/** The subset of participants that are external — the only ones looked up in stakeholderIndex. */
function filterExternalParticipants(participants) {
  return (participants || []).filter((p) => p && p.email && !isInternalDomain(p.email));
}

/** 'outbound' if the sender is on an internal domain, 'inbound' otherwise. */
function classifyDirection(fromEmail) {
  return isInternalDomain(fromEmail) ? 'outbound' : 'inbound';
}

module.exports = {
  INTERNAL_MAIL_DOMAINS,
  PERSONAL_MAIL_DOMAINS,
  getEmailDomain,
  parseAddressList,
  hasExternalParticipant,
  filterExternalParticipants,
  classifyDirection,
};
