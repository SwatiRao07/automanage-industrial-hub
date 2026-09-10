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

/**
 * Which of the given contact emails do NOT yet resolve, via a
 * lowercased-email -> projectIds[] lookup (the shape of the
 * `stakeholderIndex` collection), to the given project. Pure — the Firestore
 * reads that build emailToProjectIds happen in index.js.
 *
 * Safety net for processEmailBackfillJobs: addProjectBackfillStakeholders
 * writes a contact into project.externalRecipients synchronously, but
 * stakeholderIndex is populated by an async Firestore trigger that isn't
 * guaranteed to have caught up by the time the backfill scheduler picks the
 * job up. If it hasn't, processGmailMessage's matching would find zero or
 * multiple candidate projects for this contact's messages and silently route
 * them to unassignedEmails instead of this project — and because the
 * gmailIngestedMessages/gmailIngestedMessageIds dedup markers are permanent,
 * that misrouting can never be corrected by re-running the backfill. So
 * processEmailBackfillJobs checks this before spending any Gmail API calls on
 * a tick's batch of contacts.
 */
function findUnresolvedContacts(contactEmails, projectId, emailToProjectIds) {
  return (contactEmails || []).filter((email) => {
    const key = String(email || '').toLowerCase().trim();
    const ids = (emailToProjectIds && emailToProjectIds[key]) || [];
    return !ids.includes(projectId);
  });
}

/**
 * Compute the fields to upsert into emailBackfillJobs/{projectId} when
 * extending an existing in-progress job (or creating a fresh one) with newly
 * queued contacts. Callers only invoke this when pendingContactEmails is
 * non-empty, so the resulting contacts list always changes — the caller must
 * therefore also clear pageToken in the same write: a Gmail pageToken is
 * bound to the exact search query that produced it, and appending contacts
 * changes which contacts fall into the next batch, so an old pageToken can no
 * longer be safely resumed.
 *
 * Also preserves an existing job's original requestedByUid rather than
 * overwriting it: the job's Gmail search always runs using that admin's
 * connected mailbox access token, so a different admin extending the job must
 * not silently redirect it to their own (differently-scoped) token.
 */
function buildBackfillJobFields({ existingJob, pendingContactEmails, requestedByUid, defaultSinceDate }) {
  const combinedContacts = new Set((existingJob && existingJob.contacts) || []);
  for (const email of pendingContactEmails || []) combinedContacts.add(email);
  return {
    status: 'pending',
    contacts: [...combinedContacts],
    completedContacts: (existingJob && existingJob.completedContacts) || [],
    sinceDate: (existingJob && existingJob.sinceDate) || defaultSinceDate,
    processedCount: (existingJob && existingJob.processedCount) || 0,
    matchedCount: (existingJob && existingJob.matchedCount) || 0,
    requestedByUid: (existingJob && existingJob.requestedByUid) || requestedByUid,
  };
}

module.exports = {
  extractExternalParticipantsFromHeaders,
  mergeParticipantsIntoAccumulator,
  buildContactDirectory,
  formatGmailDate,
  buildBackfillSearchQuery,
  findUnresolvedContacts,
  buildBackfillJobFields,
};
