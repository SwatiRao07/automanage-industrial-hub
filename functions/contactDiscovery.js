// functions/contactDiscovery.js
// Pure helpers for the one-time contact-discovery scan and the 12-month
// email backfill — see docs/superpowers/specs/2026-09-10-communications-backfill-design.md.
const { parseAddressList, filterExternalParticipants, getEmailDomain } = require('./emailIngestion');

function getHeader(headers, name) {
  const header = (headers || []).find((h) => h && h.name && h.name.toLowerCase() === name.toLowerCase());
  return header ? header.value : '';
}

/** External (non-internal-domain) From/To/Cc participants of a Gmail metadata-format message's headers. */
function extractExternalParticipantsFromHeaders(headers) {
  const participants = [
    ...parseAddressList(getHeader(headers, 'From')),
    ...parseAddressList(getHeader(headers, 'To')),
    ...parseAddressList(getHeader(headers, 'Cc')),
  ];
  return filterExternalParticipants(participants);
}

/** Merge a message's external participants into a {email: {name, count, lastSeenAt}} accumulator map. */
function mergeParticipantsIntoAccumulator(accumulator, participants, seenAtIso) {
  for (const participant of participants || []) {
    const email = String((participant && participant.email) || '').toLowerCase().trim();
    if (!email) continue;
    const existing = accumulator[email];
    if (existing) {
      existing.count += 1;
      if (!existing.name && participant.name) existing.name = participant.name;
      if (seenAtIso > existing.lastSeenAt) existing.lastSeenAt = seenAtIso;
    } else {
      accumulator[email] = { name: participant.name || '', count: 1, lastSeenAt: seenAtIso };
    }
  }
  return accumulator;
}

/** Convert an accumulator map into a domain-tagged contact list, sorted by message count descending. */
function buildContactDirectory(accumulator) {
  return Object.entries(accumulator || {})
    .map(([email, entry]) => ({
      email,
      name: entry.name || '',
      domain: getEmailDomain(email) || '',
      messageCount: entry.count,
      lastSeenAt: entry.lastSeenAt,
    }))
    .sort((a, b) => b.messageCount - a.messageCount);
}

/** Format a Date as Gmail search syntax's after:/before: date (UTC, YYYY/MM/DD). */
function formatGmailDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

/** Gmail search query matching any message to/from any of the given contacts, since sinceDate. */
function buildBackfillSearchQuery(contactEmails, sinceDate) {
  const clauses = contactEmails.flatMap((email) => [`from:${email}`, `to:${email}`]);
  return `(${clauses.join(' OR ')}) after:${formatGmailDate(sinceDate)}`;
}

module.exports = {
  extractExternalParticipantsFromHeaders,
  mergeParticipantsIntoAccumulator,
  buildContactDirectory,
  formatGmailDate,
  buildBackfillSearchQuery,
};
