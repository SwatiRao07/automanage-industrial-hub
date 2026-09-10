# Communications Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin build a one-time contact directory from their own connected Gmail mailbox, pick which discovered contacts are a project's stakeholders, backfill the last 12 months of email involving those contacts into the project, delete an email/meeting from a project's Communications tab (permanently, never re-captured), and make sure a project that has moved into Support stays reachable (and keeps showing its Communications tab) even when its status is `Archived`.

**Architecture:** Two new resumable, chunked background jobs (`gmailContactDiscoveryJobs`, `emailBackfillJobs`) driven by scheduled functions in the same style as the existing `syncGmailAccounts` poller — no new infra (no Cloud Tasks). Contact discovery scans the requesting admin's Gmail via `messages.list` + metadata-only `messages.get`, building a reusable per-user `gmailContactDirectory`. Backfill reuses the **existing, unmodified** `processGmailMessage` function (dedup, capture-scope guard, `stakeholderIndex` matching, sanitize, store) — it doesn't care whether a message id came from Gmail's History API (live sync) or a `messages.list?q=...` search (backfill). Selected contacts are persisted into `project.externalRecipients` (with `notificationsEnabled: false`, so they're stakeholder-matchable without being opted into BOM-change emails), which flows into `stakeholderIndex` unchanged. Delete is a straight document delete — the pre-existing `gmailIngestedMessages`/`fathomIngestedMeetings` dedup markers (written once at first ingestion, never removed) already stop any future sync or backfill from re-writing the same message/meeting. Support visibility is a one-line fix to `Projects.tsx`, which currently hides every `Archived` project unconditionally.

**Tech Stack:** Firebase Cloud Functions v2 (Node 22, CommonJS), Firestore, React + TypeScript (Vite), shadcn/ui, `node:test` for functions unit tests, Vitest + React Testing Library for frontend tests, Gmail API (REST, `messages.list` / `messages.get`, no `googleapis` SDK dependency — same convention as the existing email-capture code).

**Spec:** `docs/superpowers/specs/2026-09-10-communications-backfill-design.md`

## Global Constraints

- Contact discovery scans only the requesting admin's own connected Gmail account (`gmailConnections/{uid}`) — not other teammates' mailboxes (spec Decision 1).
- The stakeholder picker pre-filters to domains matching the project's linked client, with all other domains available in an expandable section (spec Decision 2).
- Delete is permanent (no restore) and relies on the pre-existing dedup markers to guarantee a deleted item is never re-captured — no new "excluded" field (spec Decision 3, Design §6).
- Support visibility gate is `project.supportProfile` populated, independent of `status` (spec Decision 4).
- The UI requires a second, explicit confirmation (naming contact count + the 12-month window) between selecting contacts and starting the backfill — selecting contacts and starting the backfill are never the same click (conversation decision after spec approval).
- Job execution is chunked scheduled polling (same family as `syncGmailAccounts`), not Cloud Tasks (spec Decision 6).
- Contacts added via the picker are written into `project.externalRecipients` with `notificationsEnabled: false` — they must not be silently opted into BOM-change notification emails (spec Design §4, confirmed against `getNotificationRecipients` in `src/utils/projectFirestore.ts`).
- Backfill only ever calls the existing `processGmailMessage` (`functions/index.js`) — no parallel storage/matching code path (spec Design §5).
- No attachments, no meeting backfill (Fathom has no historical API), no scanning of other teammates' mailboxes (spec Non-goals).

---

### Task 1: `functions/contactDiscovery.js` — pure contact-extraction, grouping, and query-building helpers

**Files:**
- Create: `functions/contactDiscovery.js`
- Test: `functions/contactDiscovery.test.js`

**Interfaces:**
- Consumes: `parseAddressList`, `filterExternalParticipants`, `getEmailDomain` from `functions/emailIngestion.js` (already exported).
- Produces: `extractExternalParticipantsFromHeaders(headers) => [{name, email}]`, `mergeParticipantsIntoAccumulator(accumulator, participants, seenAtIso) => accumulator`, `buildContactDirectory(accumulator) => [{email, name, domain, messageCount, lastSeenAt}]`, `formatGmailDate(date) => 'YYYY/MM/DD'`, `buildBackfillSearchQuery(contactEmails, sinceDate) => string`. Consumed by Task 4 (`processContactDiscoveryJobs`) and Task 7 (`processEmailBackfillJobs`).

- [ ] **Step 1: Write the failing tests**

```js
// functions/contactDiscovery.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractExternalParticipantsFromHeaders,
  mergeParticipantsIntoAccumulator,
  buildContactDirectory,
  formatGmailDate,
  buildBackfillSearchQuery,
} = require('./contactDiscovery');

test('extractExternalParticipantsFromHeaders pulls From/To/Cc and drops internal-domain participants', () => {
  const headers = [
    { name: 'From', value: '"Jane Client" <jane@clientco.com>' },
    { name: 'To', value: 'host@qualitastech.com' },
    { name: 'Cc', value: 'teammate@datasensor.in, "Bob Vendor" <bob@vendorco.com>' },
  ];
  const result = extractExternalParticipantsFromHeaders(headers);
  assert.deepEqual(result, [
    { name: 'Jane Client', email: 'jane@clientco.com' },
    { name: 'Bob Vendor', email: 'bob@vendorco.com' },
  ]);
});

test('extractExternalParticipantsFromHeaders returns an empty array for a purely internal message', () => {
  const headers = [
    { name: 'From', value: 'host@qualitastech.com' },
    { name: 'To', value: 'teammate@datasensor.in' },
  ];
  assert.deepEqual(extractExternalParticipantsFromHeaders(headers), []);
});

test('mergeParticipantsIntoAccumulator adds a new contact with count 1', () => {
  const accumulator = {};
  mergeParticipantsIntoAccumulator(accumulator, [{ name: 'Jane', email: 'Jane@ClientCo.com' }], '2026-01-01T00:00:00.000Z');
  assert.deepEqual(accumulator, {
    'jane@clientco.com': { name: 'Jane', count: 1, lastSeenAt: '2026-01-01T00:00:00.000Z' },
  });
});

test('mergeParticipantsIntoAccumulator increments count and keeps the latest lastSeenAt on repeat contact', () => {
  const accumulator = { 'jane@clientco.com': { name: 'Jane', count: 2, lastSeenAt: '2026-01-01T00:00:00.000Z' } };
  mergeParticipantsIntoAccumulator(accumulator, [{ name: '', email: 'jane@clientco.com' }], '2026-02-01T00:00:00.000Z');
  assert.deepEqual(accumulator, {
    'jane@clientco.com': { name: 'Jane', count: 3, lastSeenAt: '2026-02-01T00:00:00.000Z' },
  });
});

test('mergeParticipantsIntoAccumulator ignores blank emails', () => {
  const accumulator = {};
  mergeParticipantsIntoAccumulator(accumulator, [{ name: '', email: '' }], '2026-01-01T00:00:00.000Z');
  assert.deepEqual(accumulator, {});
});

test('buildContactDirectory converts the accumulator into a domain-tagged list sorted by message count desc', () => {
  const accumulator = {
    'a@x.com': { name: 'A', count: 1, lastSeenAt: '2026-01-01T00:00:00.000Z' },
    'b@y.com': { name: 'B', count: 5, lastSeenAt: '2026-01-02T00:00:00.000Z' },
  };
  const result = buildContactDirectory(accumulator);
  assert.deepEqual(result, [
    { email: 'b@y.com', name: 'B', domain: 'y.com', messageCount: 5, lastSeenAt: '2026-01-02T00:00:00.000Z' },
    { email: 'a@x.com', name: 'A', domain: 'x.com', messageCount: 1, lastSeenAt: '2026-01-01T00:00:00.000Z' },
  ]);
});

test('formatGmailDate formats a UTC date as Gmail search syntax (YYYY/MM/DD)', () => {
  assert.equal(formatGmailDate(new Date('2026-01-05T23:00:00.000Z')), '2026/01/05');
  assert.equal(formatGmailDate(new Date('2025-12-31T00:00:00.000Z')), '2025/12/31');
});

test('buildBackfillSearchQuery ORs from:/to: clauses for every contact and appends the date filter', () => {
  const query = buildBackfillSearchQuery(['a@x.com', 'b@y.com'], new Date('2025-09-10T00:00:00.000Z'));
  assert.equal(query, '(from:a@x.com OR to:a@x.com OR from:b@y.com OR to:b@y.com) after:2025/09/10');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test functions/contactDiscovery.test.js`
Expected: FAIL with `Cannot find module './contactDiscovery'`

- [ ] **Step 3: Implement `functions/contactDiscovery.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test functions/contactDiscovery.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/contactDiscovery.js functions/contactDiscovery.test.js
git commit -m "feat: add contact-discovery extraction, grouping, and query-building helpers"
```

---

### Task 2: Gmail search + metadata-headers API wrappers

**Files:**
- Modify: `functions/emailIngestion.js`
- Test: `functions/emailIngestion.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `searchGmailMessageIds({ accessToken, query, pageToken, fetchImpl }) => Promise<{ messageIds: string[], nextPageToken: string|null }>`, `getGmailMessageHeaders({ accessToken, messageId, fetchImpl }) => Promise<Array<{name, value}>>`. Consumed by Task 4 (`processContactDiscoveryJobs`) and Task 7 (`processEmailBackfillJobs`).

- [ ] **Step 1: Write the failing tests**

```js
// append to functions/emailIngestion.test.js
const { searchGmailMessageIds, getGmailMessageHeaders } = require('./emailIngestion');

test('searchGmailMessageIds lists message ids for a search query and returns the next page token', async () => {
  const fetchImpl = async (url, options) => {
    assert.match(String(url), /q=after%3A2025%2F09%2F10/);
    assert.equal(options.headers.Authorization, 'Bearer token');
    return {
      ok: true,
      json: async () => ({ messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 'p2' }),
    };
  };
  const result = await searchGmailMessageIds({ accessToken: 'token', query: 'after:2025/09/10', fetchImpl });
  assert.deepEqual(result, { messageIds: ['m1', 'm2'], nextPageToken: 'p2' });
});

test('searchGmailMessageIds includes pageToken when provided and returns null when there is no next page', async () => {
  const fetchImpl = async (url) => {
    assert.match(String(url), /pageToken=p2/);
    return { ok: true, json: async () => ({ messages: [{ id: 'm3' }] }) };
  };
  const result = await searchGmailMessageIds({ accessToken: 'token', query: 'q', pageToken: 'p2', fetchImpl });
  assert.deepEqual(result, { messageIds: ['m3'], nextPageToken: null });
});

test('searchGmailMessageIds returns an empty list when Gmail finds no matches', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({}) });
  const result = await searchGmailMessageIds({ accessToken: 'token', query: 'q', fetchImpl });
  assert.deepEqual(result, { messageIds: [], nextPageToken: null });
});

test('searchGmailMessageIds throws on a failed request', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500 });
  await assert.rejects(
    () => searchGmailMessageIds({ accessToken: 'token', query: 'q', fetchImpl }),
    /Gmail messages.list failed: 500/
  );
});

test('getGmailMessageHeaders fetches metadata-format headers only', async () => {
  const fetchImpl = async (url, options) => {
    assert.match(String(url), /messages\/msg_1/);
    assert.match(String(url), /format=metadata/);
    assert.match(String(url), /metadataHeaders=From/);
    assert.match(String(url), /metadataHeaders=To/);
    assert.match(String(url), /metadataHeaders=Cc/);
    assert.equal(options.headers.Authorization, 'Bearer token');
    return { ok: true, json: async () => ({ payload: { headers: [{ name: 'From', value: 'a@x.com' }] } }) };
  };
  const result = await getGmailMessageHeaders({ accessToken: 'token', messageId: 'msg_1', fetchImpl });
  assert.deepEqual(result, [{ name: 'From', value: 'a@x.com' }]);
});

test('getGmailMessageHeaders returns an empty array when the payload has no headers', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({}) });
  const result = await getGmailMessageHeaders({ accessToken: 'token', messageId: 'msg_1', fetchImpl });
  assert.deepEqual(result, []);
});

test('getGmailMessageHeaders throws on a failed request', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404 });
  await assert.rejects(
    () => getGmailMessageHeaders({ accessToken: 'token', messageId: 'msg_1', fetchImpl }),
    /Gmail messages.get \(metadata\) failed: 404/
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test functions/emailIngestion.test.js`
Expected: FAIL — `searchGmailMessageIds is not a function` (and similarly for `getGmailMessageHeaders`)

- [ ] **Step 3: Implement the two functions**

Append to `functions/emailIngestion.js`, before `module.exports`:

```js
/** List message ids matching a Gmail search query (messages.list), one page per call. */
async function searchGmailMessageIds({ accessToken, query, pageToken, fetchImpl }) {
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', '50');
  if (pageToken) url.searchParams.set('pageToken', pageToken);

  const response = await fetchImpl(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    throw new Error(`Gmail messages.list failed: ${response.status}`);
  }
  const payload = await response.json();
  return {
    messageIds: (payload.messages || []).map((m) => m.id),
    nextPageToken: payload.nextPageToken || null,
  };
}

/** Fetch only the From/To/Cc headers of a message — far cheaper than format=full, used for contact discovery. */
async function getGmailMessageHeaders({ accessToken, messageId, fetchImpl }) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`);
  url.searchParams.set('format', 'metadata');
  for (const header of ['From', 'To', 'Cc']) {
    url.searchParams.append('metadataHeaders', header);
  }
  const response = await fetchImpl(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    throw new Error(`Gmail messages.get (metadata) failed: ${response.status}`);
  }
  const payload = await response.json();
  return (payload.payload && payload.payload.headers) || [];
}
```

Update `module.exports` to add `searchGmailMessageIds, getGmailMessageHeaders`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test functions/emailIngestion.test.js`
Expected: PASS (all existing tests plus the 7 new ones)

- [ ] **Step 5: Commit**

```bash
git add functions/emailIngestion.js functions/emailIngestion.test.js
git commit -m "feat: add Gmail search and metadata-headers wrappers for contact discovery and backfill"
```

---

### Task 3: Firestore rules for the new job/directory collections

**Files:**
- Modify: `firestore.rules`
- Modify: `functions/firestoreRules.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: rule blocks read by Tasks 4-8's callables/scheduled functions (which use the Admin SDK and so bypass rules) and by the frontend (Task 10), which reads `gmailContactDirectory/{uid}`, `gmailContactDiscoveryJobs/{uid}`, and `emailBackfillJobs/{projectId}` directly via `onSnapshot`.

- [ ] **Step 1: Write the failing tests**

```js
// append to functions/firestoreRules.test.js
test('gmailContactDirectory and gmailContactDiscoveryJobs are readable only by their own uid, never client-writable', () => {
  for (const collection of ['gmailContactDirectory', 'gmailContactDiscoveryJobs']) {
    assert.match(
      rules,
      new RegExp(`match /${collection}/\\{uid\\} \\{[\\s\\S]{0,300}?allow read: if request\\.auth != null[\\s\\S]{0,100}?request\\.auth\\.uid == uid[\\s\\S]{0,100}?allow write: if false;`),
      `${collection} must be per-uid read-only`
    );
  }
});

test('emailBackfillJobs is readable by project members and admins, never client-writable', () => {
  assert.match(
    rules,
    /match \/emailBackfillJobs\/\{projectId\} \{[\s\S]{0,600}?allow read: if request\.auth != null[\s\S]{0,500}?allow write: if false;/
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test functions/firestoreRules.test.js`
Expected: FAIL — no match found for either new test

- [ ] **Step 3: Add the rules**

In `firestore.rules`, add after the `fathomIngestedMeetings` block (before the `unassignedEmails`/`unassignedMeetings` block):

```
    // Contact-discovery directory and job state are per-user and only ever
    // written by processContactDiscoveryJobs (Admin SDK). The owning user can
    // read their own directory/job to show scan progress and the picker.
    match /gmailContactDirectory/{uid} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow write: if false;
    }

    match /gmailContactDiscoveryJobs/{uid} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow write: if false;
    }

    // Backfill job state, one doc per project. Project members can read it to
    // show progress; only addProjectBackfillStakeholders / processEmailBackfillJobs
    // (Admin SDK) ever write it.
    match /emailBackfillJobs/{projectId} {
      allow read: if request.auth != null
        && request.auth.token.status == 'approved'
        && (request.auth.token.role == 'admin'
            || get(/databases/$(database)/documents/projects/$(projectId)).data.memberIds == null
            || request.auth.uid in get(/databases/$(database)/documents/projects/$(projectId)).data.memberIds);
      allow write: if false;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test functions/firestoreRules.test.js`
Expected: PASS (both new tests plus the existing one)

- [ ] **Step 5: Commit**

```bash
git add firestore.rules functions/firestoreRules.test.js
git commit -m "feat: add Firestore rules for contact-discovery and backfill job collections"
```

---

### Task 4: `startContactDiscovery` callable + `processContactDiscoveryJobs` scheduled function

**Files:**
- Modify: `functions/index.js`

**Interfaces:**
- Consumes: `refreshAccessToken` (existing), `searchGmailMessageIds`, `getGmailMessageHeaders` from Task 2; `extractExternalParticipantsFromHeaders`, `mergeParticipantsIntoAccumulator`, `buildContactDirectory`, `formatGmailDate` from Task 1.
- Produces: `exports.startContactDiscovery` (callable: `{}` → `{ status: 'scanning' | 'ready' }`), `exports.processContactDiscoveryJobs` (scheduled, no direct consumers). Writes `gmailContactDiscoveryJobs/{uid}` and `gmailContactDirectory/{uid}`, read by Task 10's frontend utils.

- [ ] **Step 1: Extend the emailIngestion and contactDiscovery requires**

Update the `require('./emailIngestion')` block (functions/index.js:38-48) to also pull in `searchGmailMessageIds, getGmailMessageHeaders`, and add a new require for `functions/contactDiscovery.js` directly below it:

```js
const {
  exchangeAuthCodeForTokens,
  refreshAccessToken,
  listNewGmailMessageIds,
  getGmailMessage,
  parseGmailMessage,
  hasExternalParticipant,
  getExternalParticipantEmails,
  classifyDirection,
  sanitizeEmailBody,
  searchGmailMessageIds,
  getGmailMessageHeaders,
} = require('./emailIngestion');
const {
  extractExternalParticipantsFromHeaders,
  mergeParticipantsIntoAccumulator,
  buildContactDirectory,
  buildBackfillSearchQuery,
  formatGmailDate,
} = require('./contactDiscovery');
```

- [ ] **Step 2: Add the callable and scheduled function**

Add directly below `exports.getGmailConnectionStatus`:

```js
const CONTACT_DIRECTORY_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const BACKFILL_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;
const DISCOVERY_PAGES_PER_TICK = 2;

/**
 * Kick off (or resume) a one-time scan of the caller's own connected Gmail
 * mailbox, building a reusable contact directory. Idempotent: a fresh
 * directory (<30 days old) or an already-running scan is a no-op.
 */
exports.startContactDiscovery = onCall(async (request) => {
  const { auth } = request;
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  if (auth.token.status !== 'approved') {
    throw new functions.https.HttpsError('permission-denied', 'Approved access is required');
  }

  const db = admin.firestore();
  const connectionSnap = await db.collection('gmailConnections').doc(auth.uid).get();
  if (!connectionSnap.exists || connectionSnap.data().status !== 'connected') {
    throw new functions.https.HttpsError('failed-precondition', 'Connect Gmail in Settings before discovering contacts');
  }

  const directorySnap = await db.collection('gmailContactDirectory').doc(auth.uid).get();
  const isFresh = directorySnap.exists
    && directorySnap.data().lastScannedAt
    && (Date.now() - directorySnap.data().lastScannedAt.toDate().getTime()) < CONTACT_DIRECTORY_STALE_MS;
  if (isFresh) {
    return { status: 'ready' };
  }

  const jobRef = db.collection('gmailContactDiscoveryJobs').doc(auth.uid);
  const jobSnap = await jobRef.get();
  if (jobSnap.exists && jobSnap.data().status === 'scanning') {
    return { status: 'scanning' };
  }

  await jobRef.set({
    status: 'scanning',
    accumulated: {},
    sinceDate: new Date(Date.now() - BACKFILL_LOOKBACK_MS),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { status: 'scanning' };
});

/** Advance every in-progress contact-discovery job by a bounded number of pages. */
exports.processContactDiscoveryJobs = onSchedule(
  {
    schedule: 'every 5 minutes',
    secrets: [googleOAuthClientId, googleOAuthClientSecret],
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async () => {
    const db = admin.firestore();
    const jobsSnap = await db.collection('gmailContactDiscoveryJobs').where('status', '==', 'scanning').get();
    if (jobsSnap.empty) return;

    const clientId = googleOAuthClientId.value();
    const clientSecret = googleOAuthClientSecret.value();

    for (const jobDoc of jobsSnap.docs) {
      const uid = jobDoc.id;
      try {
        await processOneContactDiscoveryJob({ db, uid, jobRef: jobDoc.ref, job: jobDoc.data(), clientId, clientSecret });
      } catch (error) {
        logger.error('processContactDiscoveryJobs: job failed', { uid, error: error.message });
        await jobDoc.ref.set({ status: 'failed', error: error.message }, { merge: true });
      }
    }
  }
);

async function processOneContactDiscoveryJob({ db, uid, jobRef, job, clientId, clientSecret }) {
  const connectionSnap = await db.collection('gmailConnections').doc(uid).get();
  if (!connectionSnap.exists || connectionSnap.data().status !== 'connected') {
    await jobRef.set({ status: 'failed', error: 'Gmail account is no longer connected' }, { merge: true });
    return;
  }
  const { accessToken } = await refreshAccessToken({
    refreshToken: connectionSnap.data().refreshToken, clientId, clientSecret, fetchImpl: fetch,
  });

  const query = `after:${formatGmailDate(job.sinceDate.toDate())}`;
  const accumulated = job.accumulated || {};
  let pageToken = job.pageToken || undefined;

  // Bounded work per tick — the job resumes from pageToken on the next
  // scheduled run, so a large mailbox finishes over several ticks safely
  // within the function timeout.
  for (let page = 0; page < DISCOVERY_PAGES_PER_TICK; page += 1) {
    const { messageIds, nextPageToken } = await searchGmailMessageIds({ accessToken, query, pageToken, fetchImpl: fetch });
    for (const messageId of messageIds) {
      const headers = await getGmailMessageHeaders({ accessToken, messageId, fetchImpl: fetch });
      const participants = extractExternalParticipantsFromHeaders(headers);
      mergeParticipantsIntoAccumulator(accumulated, participants, new Date().toISOString());
    }
    pageToken = nextPageToken;
    if (!pageToken) break;
  }

  if (pageToken) {
    await jobRef.set(
      { accumulated, pageToken, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    return;
  }

  await db.collection('gmailContactDirectory').doc(uid).set({
    contacts: buildContactDirectory(accumulated),
    scannedFromDate: job.sinceDate,
    lastScannedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await jobRef.set({ status: 'ready', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
}
```

- [ ] **Step 3: Lint**

Run: `cd functions && npx eslint index.js`
Expected: no new errors

- [ ] **Step 4: Commit**

```bash
git add functions/index.js
git commit -m "feat: add startContactDiscovery callable and processContactDiscoveryJobs scheduler"
```

---

### Task 5: `processGmailMessage` reports whether it matched a project

**Files:**
- Modify: `functions/index.js` (the `processGmailMessage` function)

**Interfaces:**
- Consumes: nothing new.
- Produces: `processGmailMessage({ db, accessToken, messageId, geminiApiKey }) => Promise<boolean>` (previously returned `undefined`/no value; now resolves `true` when the message was matched to exactly one project, `false` for every other outcome — dropped as drafts/spam/internal-only, unassigned, or already deduped). Consumed by Task 7 (`processEmailBackfillJobs`, for `matchedCount`). `syncOneGmailAccount`'s existing call site already discards the return value, so this is a purely additive change with no other callers to update.

- [ ] **Step 1: Add return values**

In `functions/index.js`, locate `processGmailMessage` by name (Task 4's additions earlier in the file will have shifted its original line numbers — use Grep for `async function processGmailMessage`, don't trust a stale line number). It currently has four `return;` statements (drafts/spam/trash/chat, purely-internal, per-mailbox dedup hit, global dedup hit) and one implicit fall-through after filing the message. Change each:

```js
  if (labels.has('DRAFT') || labels.has('SPAM') || labels.has('TRASH') || labels.has('CHAT')) {
    // Drafts/spam/trash/chat are never real captured correspondence.
    await dedupRef.set({ ingestedAt: admin.firestore.FieldValue.serverTimestamp(), captured: false });
    return false;
  }
```

```js
  if (!hasExternalParticipant(participants)) {
    // Purely internal thread: never written anywhere, not even unassignedEmails.
    await dedupRef.set({ ingestedAt: admin.firestore.FieldValue.serverTimestamp(), captured: false });
    return false;
  }
```

```js
  const globalDedupSnap = await globalDedupRef.get();
  if (globalDedupSnap.exists) {
    await dedupRef.set({ ingestedAt: admin.firestore.FieldValue.serverTimestamp(), captured: false });
    return false;
  }
```

And at the very top:

```js
  const dedupSnap = await dedupRef.get();
  if (dedupSnap.exists) return false;
```

Finally, at the end of the function (after both dedup markers are written):

```js
  await dedupRef.set({ ingestedAt: admin.firestore.FieldValue.serverTimestamp(), captured: true });
  await globalDedupRef.set({ ingestedAt: admin.firestore.FieldValue.serverTimestamp(), gmailMessageId: parsed.gmailMessageId });
  return matchedProjectIds.length === 1;
```

- [ ] **Step 2: Lint**

Run: `cd functions && npx eslint index.js`
Expected: no new errors

- [ ] **Step 3: Manual verification**

Run `firebase emulators:start --only functions,firestore` and trigger `syncGmailAccounts` once via the emulator's scheduler UI (or `firebase functions:shell` calling `syncOneGmailAccount` directly against a test `gmailConnections` doc) to confirm existing live-sync behavior is unchanged — the return value is new, nothing about what gets written changed.

- [ ] **Step 4: Commit**

```bash
git add functions/index.js
git commit -m "refactor: processGmailMessage reports whether it matched a project"
```

---

### Task 6: `addProjectBackfillStakeholders` callable

**Files:**
- Modify: `functions/index.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `exports.addProjectBackfillStakeholders` (callable: `{ projectId: string, contacts: {email: string, name?: string}[] }` → `{ queuedContactCount: number }`). Writes `project.externalRecipients` (merged) and upserts `emailBackfillJobs/{projectId}`, read by Task 7 and by Task 10's frontend utils. Consumed by Task 12's UI.

- [ ] **Step 1: Add the callable**

Add directly below `exports.processContactDiscoveryJobs` (Task 4):

```js
/**
 * Merge the given contacts into a project's externalRecipients (as
 * non-notifying stakeholders, so they become stakeholder-matchable without
 * being opted into BOM-change emails) and queue an email backfill job for
 * whichever of them haven't already been backfilled. Project-member gated.
 */
exports.addProjectBackfillStakeholders = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  if (auth.token.status !== 'approved') {
    throw new functions.https.HttpsError('permission-denied', 'Approved access is required');
  }

  const { projectId, contacts } = data || {};
  if (!projectId || !Array.isArray(contacts) || contacts.length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'projectId and a non-empty contacts array are required');
  }

  const db = admin.firestore();
  const projectRef = db.collection('projects').doc(projectId);
  const projectSnap = await projectRef.get();
  if (!projectSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Project not found');
  }
  const project = projectSnap.data();
  const isAdmin = auth.token.role === 'admin';
  const isMember = !project.memberIds || project.memberIds.includes(auth.uid);
  if (!isAdmin && !isMember) {
    throw new functions.https.HttpsError('permission-denied', 'You are not a member of this project');
  }

  const normalizedContacts = contacts
    .map((c) => ({ email: String((c && c.email) || '').toLowerCase().trim(), name: String((c && c.name) || '').trim() }))
    .filter((c) => c.email);
  if (normalizedContacts.length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'No valid contact emails provided');
  }

  const existingRecipients = project.externalRecipients || [];
  const existingEmails = new Set(existingRecipients.map((r) => r.email.toLowerCase()));
  const newRecipients = normalizedContacts
    .filter((c) => !existingEmails.has(c.email))
    .map((c) => ({ email: c.email, name: c.name, notificationsEnabled: false }));
  if (newRecipients.length > 0) {
    await projectRef.set(
      { externalRecipients: [...existingRecipients, ...newRecipients] },
      { merge: true }
    );
  }

  const alreadyBackfilled = new Set(project.backfilledContactEmails || []);
  const pendingContactEmails = normalizedContacts.map((c) => c.email).filter((email) => !alreadyBackfilled.has(email));
  if (pendingContactEmails.length === 0) {
    return { queuedContactCount: 0 };
  }

  const jobRef = db.collection('emailBackfillJobs').doc(projectId);
  await db.runTransaction(async (tx) => {
    const jobSnap = await tx.get(jobRef);
    const existingJob = jobSnap.exists ? jobSnap.data() : null;
    const combinedContacts = new Set((existingJob && existingJob.contacts) || []);
    for (const email of pendingContactEmails) combinedContacts.add(email);

    tx.set(jobRef, {
      status: 'pending',
      contacts: [...combinedContacts],
      completedContacts: (existingJob && existingJob.completedContacts) || [],
      sinceDate: (existingJob && existingJob.sinceDate) || new Date(Date.now() - BACKFILL_LOOKBACK_MS),
      processedCount: (existingJob && existingJob.processedCount) || 0,
      matchedCount: (existingJob && existingJob.matchedCount) || 0,
      requestedByUid: auth.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  logger.info('addProjectBackfillStakeholders: queued', { projectId, queuedContactCount: pendingContactEmails.length, by: auth.uid });
  return { queuedContactCount: pendingContactEmails.length };
});
```

- [ ] **Step 2: Lint**

Run: `cd functions && npx eslint index.js`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add functions/index.js
git commit -m "feat: add addProjectBackfillStakeholders callable"
```

---

### Task 7: `processEmailBackfillJobs` scheduled function

**Files:**
- Modify: `functions/index.js`

**Interfaces:**
- Consumes: `buildBackfillSearchQuery` from Task 1; `searchGmailMessageIds` from Task 2; `processGmailMessage` (now returning a boolean, Task 5).
- Produces: `exports.processEmailBackfillJobs` (scheduled, no direct consumers). Writes `projects/{id}/emails` and `unassignedEmails` (via the reused `processGmailMessage`), updates `emailBackfillJobs/{projectId}` and `project.backfilledContactEmails`, read by Task 10's frontend utils and Task 13's UI.

- [ ] **Step 1: Add the scheduled function**

Add directly below `exports.addProjectBackfillStakeholders` (Task 6):

```js
const BACKFILL_CONTACTS_PER_BATCH = 25;

/** Advance every pending/running email backfill job by a bounded number of Gmail search results. */
exports.processEmailBackfillJobs = onSchedule(
  {
    schedule: 'every 10 minutes',
    secrets: [googleOAuthClientId, googleOAuthClientSecret, geminiApiKeySecret],
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async () => {
    const db = admin.firestore();
    const jobsSnap = await db.collection('emailBackfillJobs').where('status', 'in', ['pending', 'running']).get();
    if (jobsSnap.empty) return;

    const clientId = googleOAuthClientId.value();
    const clientSecret = googleOAuthClientSecret.value();
    const geminiApiKey = geminiApiKeySecret.value();

    for (const jobDoc of jobsSnap.docs) {
      const projectId = jobDoc.id;
      try {
        await processOneEmailBackfillJob({ db, projectId, jobRef: jobDoc.ref, job: jobDoc.data(), clientId, clientSecret, geminiApiKey });
      } catch (error) {
        logger.error('processEmailBackfillJobs: job failed', { projectId, error: error.message });
        await jobDoc.ref.set({ status: 'failed', error: error.message }, { merge: true });
      }
    }
  }
);

async function processOneEmailBackfillJob({ db, projectId, jobRef, job, clientId, clientSecret, geminiApiKey }) {
  const completed = new Set(job.completedContacts || []);
  const allContacts = job.contacts || [];
  const remaining = allContacts.filter((email) => !completed.has(email));

  if (remaining.length === 0) {
    await jobRef.set({ status: 'completed', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await db.collection('projects').doc(projectId).set({ backfilledContactEmails: allContacts }, { merge: true });
    return;
  }

  const connectionSnap = await db.collection('gmailConnections').doc(job.requestedByUid).get();
  if (!connectionSnap.exists || connectionSnap.data().status !== 'connected') {
    await jobRef.set({ status: 'failed', error: 'Gmail account is no longer connected' }, { merge: true });
    return;
  }
  const { accessToken } = await refreshAccessToken({
    refreshToken: connectionSnap.data().refreshToken, clientId, clientSecret, fetchImpl: fetch,
  });

  const batch = remaining.slice(0, BACKFILL_CONTACTS_PER_BATCH);
  const query = buildBackfillSearchQuery(batch, job.sinceDate.toDate());
  let pageToken = job.pageToken || undefined;
  let processedCount = job.processedCount || 0;
  let matchedCount = job.matchedCount || 0;

  // One page (up to 50 messages, each involving a full Gemini sanitize call)
  // per tick — the job resumes from pageToken on the next scheduled run.
  const { messageIds, nextPageToken } = await searchGmailMessageIds({ accessToken, query, pageToken, fetchImpl: fetch });
  for (const messageId of messageIds) {
    const matched = await processGmailMessage({ db, accessToken, messageId, geminiApiKey });
    processedCount += 1;
    if (matched) matchedCount += 1;
  }
  pageToken = nextPageToken;

  if (pageToken) {
    await jobRef.set(
      { status: 'running', pageToken, processedCount, matchedCount, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    return;
  }

  // This batch of contacts is fully searched — mark them done and clear the
  // page cursor so the next tick starts the next batch from scratch.
  const newCompleted = [...completed, ...batch];
  const allDone = newCompleted.length >= allContacts.length;
  await jobRef.set(
    {
      status: allDone ? 'completed' : 'running',
      completedContacts: newCompleted,
      pageToken: admin.firestore.FieldValue.delete(),
      processedCount,
      matchedCount,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  if (allDone) {
    await db.collection('projects').doc(projectId).set({ backfilledContactEmails: allContacts }, { merge: true });
  }
}
```

- [ ] **Step 2: Lint**

Run: `cd functions && npx eslint index.js`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add functions/index.js
git commit -m "feat: add processEmailBackfillJobs scheduler, reusing processGmailMessage unchanged"
```

---

### Task 8: `deleteProjectEmail` and `deleteProjectMeeting` callables

**Files:**
- Modify: `functions/index.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `exports.deleteProjectEmail` (callable: `{ projectId: string, messageId: string }` → `{ success: true }`), `exports.deleteProjectMeeting` (callable: `{ projectId: string, meetingId: string }` → `{ success: true }`). Consumed by Task 10's frontend wrappers and Task 14's UI.

- [ ] **Step 1: Add the two callables**

Add directly below `exports.processEmailBackfillJobs` (Task 7):

```js
/**
 * Permanently remove a captured email/meeting from a project's Communications
 * tab. No "excluded" flag is needed: the pre-existing gmailIngestedMessages /
 * fathomIngestedMeetings dedup marker for this id was already written at
 * first ingestion and is never deleted, so live sync and any future backfill
 * already skip re-writing it (see spec Design §6). Project-member gated,
 * since this is curation of a project's own data, not cross-project triage.
 */
async function assertProjectMember(db, projectId, auth) {
  const projectSnap = await db.collection('projects').doc(projectId).get();
  if (!projectSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Project not found');
  }
  const project = projectSnap.data();
  const isAdmin = auth.token.role === 'admin';
  const isMember = !project.memberIds || project.memberIds.includes(auth.uid);
  if (!isAdmin && !isMember) {
    throw new functions.https.HttpsError('permission-denied', 'You are not a member of this project');
  }
}

exports.deleteProjectEmail = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  if (auth.token.status !== 'approved') {
    throw new functions.https.HttpsError('permission-denied', 'Approved access is required');
  }
  const { projectId, messageId } = data || {};
  if (!projectId || !messageId) {
    throw new functions.https.HttpsError('invalid-argument', 'projectId and messageId are required');
  }

  const db = admin.firestore();
  await assertProjectMember(db, projectId, auth);
  await db.collection('projects').doc(projectId).collection('emails').doc(messageId).delete();
  logger.info('deleteProjectEmail: deleted', { projectId, messageId, by: auth.uid });
  return { success: true };
});

exports.deleteProjectMeeting = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  if (auth.token.status !== 'approved') {
    throw new functions.https.HttpsError('permission-denied', 'Approved access is required');
  }
  const { projectId, meetingId } = data || {};
  if (!projectId || !meetingId) {
    throw new functions.https.HttpsError('invalid-argument', 'projectId and meetingId are required');
  }

  const db = admin.firestore();
  await assertProjectMember(db, projectId, auth);
  await db.collection('projects').doc(projectId).collection('meetings').doc(meetingId).delete();
  logger.info('deleteProjectMeeting: deleted', { projectId, meetingId, by: auth.uid });
  return { success: true };
});
```

- [ ] **Step 2: Lint**

Run: `cd functions && npx eslint index.js`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add functions/index.js
git commit -m "feat: add deleteProjectEmail and deleteProjectMeeting callables"
```

---

### Task 9: Frontend types for contact discovery and backfill

**Files:**
- Create: `src/types/communicationsBackfill.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DiscoveredContact`, `GmailContactDirectory`, `ContactDiscoveryStatus`, `EmailBackfillJobState` types. Consumed by Task 10 (Firestore utils), Task 11 (pure grouping util), Task 12-13 (UI).

- [ ] **Step 1: Write the file**

```ts
// src/types/communicationsBackfill.ts
export interface DiscoveredContact {
  email: string;
  name: string;
  domain: string;
  messageCount: number;
  lastSeenAt: string; // ISO
}

export interface GmailContactDirectory {
  contacts: DiscoveredContact[];
  scannedFromDate: Date;
  lastScannedAt: Date;
}

export type ContactDiscoveryStatus = 'scanning' | 'ready' | 'failed';

export interface ContactDiscoveryJobState {
  status: ContactDiscoveryStatus;
  error?: string;
}

export type EmailBackfillStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface EmailBackfillJobState {
  status: EmailBackfillStatus;
  contacts: string[];
  completedContacts: string[];
  processedCount: number;
  matchedCount: number;
  error?: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add src/types/communicationsBackfill.ts
git commit -m "feat: add frontend types for contact discovery and backfill"
```

---

### Task 10: Pure grouping/domain helpers

**Files:**
- Create: `src/utils/communicationsBackfill.ts`
- Test: `src/utils/__tests__/communicationsBackfill.test.ts`

**Interfaces:**
- Consumes: `DiscoveredContact` from Task 9; `Client` from `src/utils/settingsFirestore.ts` (existing).
- Produces: `getClientDomains(client: Client | null | undefined) => string[]`, `groupContactsForPicker(contacts: DiscoveredContact[], clientDomains: string[]) => { matching: DiscoveredContact[]; otherByDomain: Record<string, DiscoveredContact[]> }`. Consumed by Task 12's UI.

- [ ] **Step 1: Write the failing tests**

```ts
// src/utils/__tests__/communicationsBackfill.test.ts
import { describe, expect, it } from 'vitest';
import { getClientDomains, groupContactsForPicker } from '../communicationsBackfill';
import type { Client } from '../settingsFirestore';
import type { DiscoveredContact } from '@/types/communicationsBackfill';

const baseClient: Client = {
  id: 'c1',
  company: 'Client Co',
  email: 'ops@clientco.com',
  phone: '',
  address: '',
  contactPerson: 'Jane',
  contacts: [
    { id: 'ct1', name: 'Jane', email: 'jane@clientco.com', phone: '', role: 'technical', isPrimary: true, isActive: true },
    { id: 'ct2', name: 'Old Bob', email: 'bob@formerdomain.com', phone: '', role: 'commercial', isPrimary: false, isActive: false },
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('getClientDomains', () => {
  it('collects domains from the client email and active contacts, deduplicated', () => {
    expect(getClientDomains(baseClient)).toEqual(['clientco.com']);
  });

  it('ignores inactive contacts', () => {
    const domains = getClientDomains({
      ...baseClient,
      email: '',
      contacts: [{ id: 'ct2', name: 'Old Bob', email: 'bob@formerdomain.com', phone: '', role: 'commercial', isPrimary: false, isActive: false }],
    });
    expect(domains).toEqual([]);
  });

  it('returns an empty array for a missing client', () => {
    expect(getClientDomains(null)).toEqual([]);
    expect(getClientDomains(undefined)).toEqual([]);
  });
});

const contact = (email: string, messageCount = 1): DiscoveredContact => ({
  email,
  name: '',
  domain: email.split('@')[1],
  messageCount,
  lastSeenAt: '2026-01-01T00:00:00.000Z',
});

describe('groupContactsForPicker', () => {
  it('splits contacts into client-domain matches and everything else, grouped by domain', () => {
    const contacts = [contact('jane@clientco.com'), contact('bob@vendorco.com'), contact('sam@vendorco.com')];
    const result = groupContactsForPicker(contacts, ['clientco.com']);
    expect(result.matching).toEqual([contact('jane@clientco.com')]);
    expect(result.otherByDomain).toEqual({ 'vendorco.com': [contact('bob@vendorco.com'), contact('sam@vendorco.com')] });
  });

  it('treats every contact as "other" when there are no client domains', () => {
    const contacts = [contact('jane@clientco.com')];
    const result = groupContactsForPicker(contacts, []);
    expect(result.matching).toEqual([]);
    expect(result.otherByDomain).toEqual({ 'clientco.com': [contact('jane@clientco.com')] });
  });

  it('handles an empty contact list', () => {
    expect(groupContactsForPicker([], ['clientco.com'])).toEqual({ matching: [], otherByDomain: {} });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/communicationsBackfill.test.ts`
Expected: FAIL — cannot find module `../communicationsBackfill`

- [ ] **Step 3: Implement `src/utils/communicationsBackfill.ts`**

```ts
// src/utils/communicationsBackfill.ts
import type { Client } from './settingsFirestore';
import type { DiscoveredContact } from '@/types/communicationsBackfill';

const domainOf = (email: string): string => email.toLowerCase().split('@')[1] || '';

/** Every distinct domain associated with a client: its own email plus every active CRM contact's email. */
export function getClientDomains(client: Client | null | undefined): string[] {
  if (!client) return [];
  const domains = new Set<string>();
  if (client.email) {
    const domain = domainOf(client.email);
    if (domain) domains.add(domain);
  }
  for (const contact of client.contacts || []) {
    if (contact.isActive === false || !contact.email) continue;
    const domain = domainOf(contact.email);
    if (domain) domains.add(domain);
  }
  return [...domains];
}

/** Split discovered contacts into ones matching the client's domain(s) and everything else, grouped by domain. */
export function groupContactsForPicker(
  contacts: DiscoveredContact[],
  clientDomains: string[]
): { matching: DiscoveredContact[]; otherByDomain: Record<string, DiscoveredContact[]> } {
  const clientDomainSet = new Set(clientDomains.map((d) => d.toLowerCase()));
  const matching: DiscoveredContact[] = [];
  const otherByDomain: Record<string, DiscoveredContact[]> = {};

  for (const contact of contacts) {
    if (clientDomainSet.has(contact.domain.toLowerCase())) {
      matching.push(contact);
    } else {
      (otherByDomain[contact.domain] ||= []).push(contact);
    }
  }

  return { matching, otherByDomain };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/communicationsBackfill.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/communicationsBackfill.ts src/utils/__tests__/communicationsBackfill.test.ts
git commit -m "feat: add client-domain and contact-grouping helpers for the backfill picker"
```

---

### Task 11: Frontend Firestore/callable wrappers

**Files:**
- Create: `src/utils/communicationsBackfillFirestore.ts`
- Modify: `src/utils/emailFirestore.ts`
- Modify: `src/utils/meetingFirestore.ts`

**Interfaces:**
- Consumes: `GmailContactDirectory`, `ContactDiscoveryJobState`, `EmailBackfillJobState` from Task 9.
- Produces: `startContactDiscovery() => Promise<{ status: 'scanning' | 'ready' }>`, `subscribeToContactDiscoveryJob(uid, cb) => Unsubscribe`, `getGmailContactDirectory(uid) => Promise<GmailContactDirectory | null>`, `addProjectBackfillStakeholders(projectId, contacts) => Promise<{ queuedContactCount: number }>`, `subscribeToEmailBackfillJob(projectId, cb) => Unsubscribe` (all in the new file); `deleteProjectEmail(projectId, messageId) => Promise<void>` (added to `emailFirestore.ts`); `deleteProjectMeeting(projectId, meetingId) => Promise<void>` (added to `meetingFirestore.ts`). Consumed by Task 12-14's UI.

- [ ] **Step 1: Add `deleteProjectEmail` to `src/utils/emailFirestore.ts`**

Append below `discardUnassignedEmail`:

```ts
/** Permanently remove a captured email from a project's Communications tab. Never re-captured (see spec). */
export const deleteProjectEmail = async (projectId: string, messageId: string): Promise<void> => {
  const fn = httpsCallable(functions, 'deleteProjectEmail');
  await fn({ projectId, messageId });
};
```

- [ ] **Step 2: Add `deleteProjectMeeting` to `src/utils/meetingFirestore.ts`**

Append below `discardUnassignedMeeting`:

```ts
/** Permanently remove a captured meeting from a project's Communications tab. Never re-captured (see spec). */
export const deleteProjectMeeting = async (projectId: string, meetingId: string): Promise<void> => {
  const fn = httpsCallable(functions, 'deleteProjectMeeting');
  await fn({ projectId, meetingId });
};
```

- [ ] **Step 3: Write `src/utils/communicationsBackfillFirestore.ts`**

```ts
// src/utils/communicationsBackfillFirestore.ts
import { db, functions } from "@/firebase";
import { doc, getDoc, onSnapshot, Timestamp, Unsubscribe } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import type {
  ContactDiscoveryJobState,
  EmailBackfillJobState,
  GmailContactDirectory,
} from "@/types/communicationsBackfill";

/** Kick off (or resume) a one-time scan of the caller's own Gmail mailbox. Idempotent. */
export const startContactDiscovery = async (): Promise<{ status: 'scanning' | 'ready' }> => {
  const fn = httpsCallable(functions, 'startContactDiscovery');
  const result = await fn({});
  return result.data as { status: 'scanning' | 'ready' };
};

/** Live-subscribe to the caller's own contact-discovery job progress. */
export const subscribeToContactDiscoveryJob = (
  uid: string,
  callback: (job: ContactDiscoveryJobState | null) => void
): Unsubscribe => {
  return onSnapshot(doc(db, 'gmailContactDiscoveryJobs', uid), (snap) => {
    if (!snap.exists()) {
      callback(null);
      return;
    }
    const data = snap.data();
    callback({ status: data.status, error: data.error });
  });
};

/** One-shot fetch of the caller's own contact directory (built by the discovery job). */
export const getGmailContactDirectory = async (uid: string): Promise<GmailContactDirectory | null> => {
  const snap = await getDoc(doc(db, 'gmailContactDirectory', uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  const toDate = (value: Timestamp | undefined) => (value ? value.toDate() : new Date());
  return {
    contacts: data.contacts || [],
    scannedFromDate: toDate(data.scannedFromDate),
    lastScannedAt: toDate(data.lastScannedAt),
  };
};

/** Add selected contacts as project stakeholders and queue their email backfill. */
export const addProjectBackfillStakeholders = async (
  projectId: string,
  contacts: { email: string; name?: string }[]
): Promise<{ queuedContactCount: number }> => {
  const fn = httpsCallable(functions, 'addProjectBackfillStakeholders');
  const result = await fn({ projectId, contacts });
  return result.data as { queuedContactCount: number };
};

/** Live-subscribe to a project's email backfill job progress. */
export const subscribeToEmailBackfillJob = (
  projectId: string,
  callback: (job: EmailBackfillJobState | null) => void
): Unsubscribe => {
  return onSnapshot(doc(db, 'emailBackfillJobs', projectId), (snap) => {
    if (!snap.exists()) {
      callback(null);
      return;
    }
    const data = snap.data();
    callback({
      status: data.status,
      contacts: data.contacts || [],
      completedContacts: data.completedContacts || [],
      processedCount: data.processedCount || 0,
      matchedCount: data.matchedCount || 0,
      error: data.error,
    });
  });
};
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Commit**

```bash
git add src/utils/communicationsBackfillFirestore.ts src/utils/emailFirestore.ts src/utils/meetingFirestore.ts
git commit -m "feat: add frontend Firestore/callable wrappers for discovery, backfill, and delete"
```

---

### Task 12: `BackfillCommunicationsDialog` — discovery and contact selection

**Files:**
- Create: `src/components/Project/BackfillCommunicationsDialog.tsx`
- Test: `src/components/Project/__tests__/BackfillCommunicationsDialog.test.tsx`

**Interfaces:**
- Consumes: `getGmailConnectionStatus` (existing, `emailFirestore.ts`); `startContactDiscovery`, `subscribeToContactDiscoveryJob`, `getGmailContactDirectory` (Task 11); `getClientDomains`, `groupContactsForPicker` (Task 10); `getClient` (existing, `settingsFirestore.ts`); `useAuth` (existing hook, for `user.uid`).
- Produces: `BackfillCommunicationsDialog` component, props `{ open: boolean; onOpenChange: (open: boolean) => void; projectId: string; clientId?: string; alreadyBackfilledEmails: string[]; onConfirm: (contacts: {email: string; name?: string}[]) => void }`. `onConfirm` is called once the admin has picked contacts and passed the second confirmation step (added in Task 13) — Task 12 renders through contact selection only, with a placeholder "Continue" button wired up fully in Task 13.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/Project/__tests__/BackfillCommunicationsDialog.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackfillCommunicationsDialog } from '../BackfillCommunicationsDialog';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'user-1' } }) }));
vi.mock('@/utils/emailFirestore', () => ({
  getGmailConnectionStatus: vi.fn().mockResolvedValue({ connected: true, status: 'connected' }),
}));
vi.mock('@/utils/settingsFirestore', () => ({
  getClient: vi.fn().mockResolvedValue({ id: 'c1', company: 'Client Co', email: 'ops@clientco.com', contacts: [] }),
}));
vi.mock('@/utils/communicationsBackfillFirestore', () => ({
  startContactDiscovery: vi.fn().mockResolvedValue({ status: 'ready' }),
  subscribeToContactDiscoveryJob: vi.fn((_uid, cb) => {
    cb({ status: 'ready' });
    return () => {};
  }),
  getGmailContactDirectory: vi.fn().mockResolvedValue({
    contacts: [
      { email: 'jane@clientco.com', name: 'Jane', domain: 'clientco.com', messageCount: 4, lastSeenAt: '2026-01-01T00:00:00.000Z' },
      { email: 'bob@vendorco.com', name: 'Bob', domain: 'vendorco.com', messageCount: 2, lastSeenAt: '2026-01-01T00:00:00.000Z' },
    ],
    scannedFromDate: new Date('2025-09-10'),
    lastScannedAt: new Date('2026-01-01'),
  }),
}));

describe('BackfillCommunicationsDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the client-domain match checked by default section and lets the admin expand other domains', async () => {
    render(
      <BackfillCommunicationsDialog
        open
        onOpenChange={() => {}}
        projectId="p1"
        clientId="c1"
        alreadyBackfilledEmails={[]}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByText(/jane@clientco.com/i)).toBeInTheDocument());
    expect(screen.queryByText(/bob@vendorco.com/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByText(/other domains/i));
    expect(screen.getByText(/bob@vendorco.com/i)).toBeInTheDocument();
  });

  it('pre-checks contacts already in alreadyBackfilledEmails', async () => {
    render(
      <BackfillCommunicationsDialog
        open
        onOpenChange={() => {}}
        projectId="p1"
        clientId="c1"
        alreadyBackfilledEmails={['jane@clientco.com']}
        onConfirm={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByText(/jane@clientco.com/i)).toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: /jane@clientco.com/i })).toBeChecked();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/Project/__tests__/BackfillCommunicationsDialog.test.tsx`
Expected: FAIL — cannot find module `../BackfillCommunicationsDialog`

- [ ] **Step 3: Implement the discovery + selection portion**

```tsx
// src/components/Project/BackfillCommunicationsDialog.tsx
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, ChevronDown } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { getGmailConnectionStatus } from '@/utils/emailFirestore';
import { getClient } from '@/utils/settingsFirestore';
import {
  startContactDiscovery,
  subscribeToContactDiscoveryJob,
  getGmailContactDirectory,
} from '@/utils/communicationsBackfillFirestore';
import { getClientDomains, groupContactsForPicker } from '@/utils/communicationsBackfill';
import type { DiscoveredContact } from '@/types/communicationsBackfill';

interface BackfillCommunicationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  clientId?: string;
  alreadyBackfilledEmails: string[];
  onConfirm: (contacts: { email: string; name?: string }[]) => void;
}

type Phase = 'checking-connection' | 'not-connected' | 'discovering' | 'selecting' | 'confirming';

export function BackfillCommunicationsDialog({
  open,
  onOpenChange,
  projectId,
  clientId,
  alreadyBackfilledEmails,
  onConfirm,
}: BackfillCommunicationsDialogProps) {
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>('checking-connection');
  const [clientDomains, setClientDomains] = useState<string[]>([]);
  const [contacts, setContacts] = useState<DiscoveredContact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(alreadyBackfilledEmails));
  const [otherOpen, setOtherOpen] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;

    (async () => {
      setPhase('checking-connection');
      const connection = await getGmailConnectionStatus();
      if (cancelled) return;
      if (!connection.connected || connection.status === 'needs_reconnect') {
        setPhase('not-connected');
        return;
      }

      if (clientId) {
        const client = await getClient(clientId);
        if (!cancelled) setClientDomains(getClientDomains(client));
      }

      setPhase('discovering');
      await startContactDiscovery();
      if (cancelled) return;

      const unsubscribe = subscribeToContactDiscoveryJob(user.uid, async (job) => {
        if (cancelled || !job) return;
        if (job.status === 'ready') {
          const directory = await getGmailContactDirectory(user.uid);
          if (!cancelled) {
            setContacts(directory?.contacts || []);
            setPhase('selecting');
          }
        }
      });
      return unsubscribe;
    })();

    return () => {
      cancelled = true;
    };
  }, [open, user, clientId]);

  const grouped = useMemo(() => groupContactsForPicker(contacts, clientDomains), [contacts, clientDomains]);

  const toggle = (email: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  };

  const renderContactRow = (contact: DiscoveredContact) => (
    <label key={contact.email} className="flex items-center gap-2 py-1 text-sm">
      <Checkbox
        checked={selected.has(contact.email)}
        onCheckedChange={() => toggle(contact.email)}
        aria-label={contact.email}
      />
      <span className="font-medium">{contact.name || contact.email}</span>
      <span className="text-muted-foreground">{contact.email}</span>
      <span className="text-xs text-muted-foreground ml-auto">{contact.messageCount} messages</span>
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Backfill Communications</DialogTitle>
        </DialogHeader>

        {phase === 'checking-connection' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking your Gmail connection...
          </div>
        )}

        {phase === 'not-connected' && (
          <p className="text-sm text-muted-foreground py-6">
            Connect Gmail in Settings before backfilling communications for this project.
          </p>
        )}

        {phase === 'discovering' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Scanning your mailbox for contacts (this can take a few minutes)...
          </div>
        )}

        {phase === 'selecting' && (
          <div className="space-y-4 max-h-96 overflow-y-auto">
            <div>
              <p className="text-sm font-medium mb-1">Matches this project's client</p>
              {grouped.matching.length > 0
                ? grouped.matching.map(renderContactRow)
                : <p className="text-sm text-muted-foreground">No contacts found on this client's domain.</p>}
            </div>
            <Collapsible open={otherOpen} onOpenChange={setOtherOpen}>
              <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium">
                <ChevronDown className={`h-4 w-4 transition-transform ${otherOpen ? 'rotate-180' : ''}`} />
                Other domains
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 mt-2">
                {Object.entries(grouped.otherByDomain).map(([domain, domainContacts]) => (
                  <div key={domain}>
                    <p className="text-xs uppercase text-muted-foreground">{domain}</p>
                    {domainContacts.map(renderContactRow)}
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {phase === 'selecting' && (
            <Button disabled={selected.size === 0} onClick={() => setPhase('confirming')}>
              Continue ({selected.size} selected)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Task 13 replaces the `phase === 'confirming'` no-op (currently just switches phase with no rendered content) with the second-confirmation UI and wires `onConfirm`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/Project/__tests__/BackfillCommunicationsDialog.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/Project/BackfillCommunicationsDialog.tsx src/components/Project/__tests__/BackfillCommunicationsDialog.test.tsx
git commit -m "feat: add contact discovery and selection step of the backfill dialog"
```

---

### Task 13: Second confirmation step + trigger + progress

**Files:**
- Modify: `src/components/Project/BackfillCommunicationsDialog.tsx`
- Modify: `src/components/Project/__tests__/BackfillCommunicationsDialog.test.tsx`

**Interfaces:**
- Consumes: `addProjectBackfillStakeholders`, `subscribeToEmailBackfillJob` from Task 11.
- Produces: the dialog now calls `onConfirm` (added in Task 12) only after the admin confirms a second, explicit step naming the contact count and 12-month window, then shows live backfill progress via `subscribeToEmailBackfillJob`. No new exports — same component.

- [ ] **Step 1: Write the failing test**

Append to `src/components/Project/__tests__/BackfillCommunicationsDialog.test.tsx` (using the same top-level `vi.mock('@/utils/communicationsBackfillFirestore', ...)` already set up in Task 12 — this component never calls `addProjectBackfillStakeholders` or `subscribeToEmailBackfillJob` itself, so no new mock entries are needed):

```tsx
describe('BackfillCommunicationsDialog confirmation step', () => {
  it('requires a second explicit confirmation naming the count and window before calling onConfirm', async () => {
    const onConfirm = vi.fn();
    render(
      <BackfillCommunicationsDialog
        open
        onOpenChange={() => {}}
        projectId="p1"
        clientId="c1"
        alreadyBackfilledEmails={[]}
        onConfirm={onConfirm}
      />
    );

    await waitFor(() => expect(screen.getByText(/jane@clientco.com/i)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('checkbox', { name: /jane@clientco.com/i }));
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(screen.getByText(/12 months/i)).toBeInTheDocument();
    expect(screen.getByText(/1 contact/i)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /start backfill/i }));
    expect(onConfirm).toHaveBeenCalledWith([{ email: 'jane@clientco.com', name: 'Jane' }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/Project/__tests__/BackfillCommunicationsDialog.test.tsx`
Expected: FAIL — "Start backfill" button not found (confirming phase currently renders nothing)

- [ ] **Step 3: Implement the confirmation + progress UI**

In `src/components/Project/BackfillCommunicationsDialog.tsx`, replace the `phase === 'selecting'` footer button's `onClick` target and add a `confirming` render branch. Add state:

```tsx
  const [starting, setStarting] = useState(false);
```

Add after the `phase === 'selecting'` block:

```tsx
        {phase === 'confirming' && (
          <div className="py-4 space-y-2 text-sm">
            <p>
              This will search the last <strong>12 months</strong> of your mailbox for messages
              involving <strong>{selected.size} contact{selected.size === 1 ? '' : 's'}</strong> and
              import any matches into this project.
            </p>
            <p className="text-muted-foreground">This can't be easily undone.</p>
          </div>
        )}
```

Update the footer to branch on `confirming`:

```tsx
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {phase === 'selecting' && (
            <Button disabled={selected.size === 0} onClick={() => setPhase('confirming')}>
              Continue ({selected.size} selected)
            </Button>
          )}
          {phase === 'confirming' && (
            <Button
              disabled={starting}
              onClick={() => {
                setStarting(true);
                const chosen = contacts
                  .filter((c) => selected.has(c.email))
                  .map((c) => ({ email: c.email, name: c.name || undefined }));
                onConfirm(chosen);
              }}
            >
              {starting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Start backfill
            </Button>
          )}
        </DialogFooter>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/Project/__tests__/BackfillCommunicationsDialog.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/Project/BackfillCommunicationsDialog.tsx src/components/Project/__tests__/BackfillCommunicationsDialog.test.tsx
git commit -m "feat: add second-confirmation step to the backfill dialog"
```

---

### Task 14: Wire the dialog, delete buttons, and progress into `ProjectCommunicationsTab`

**Files:**
- Modify: `src/components/Project/ProjectCommunicationsTab.tsx`
- Modify: `src/pages/BOM.tsx:1147-1149`
- Modify: `src/utils/projectFirestore.ts` (add `backfilledContactEmails` to the `Project` interface)

**Interfaces:**
- Consumes: `BackfillCommunicationsDialog` (Tasks 12-13); `addProjectBackfillStakeholders`, `subscribeToEmailBackfillJob` (Task 11); `deleteProjectEmail` (`emailFirestore.ts`, Task 11); `deleteProjectMeeting` (`meetingFirestore.ts`, Task 11); `Project` type (existing, `projectFirestore.ts`).
- Produces: `ProjectCommunicationsTab` now takes `{ projectId: string; project: Project; onProjectUpdated: (project: Project) => void }` (previously just `projectId`). `BOM.tsx` passes `fullProject` and a setter, matching the existing pattern already used for `ProjectMembersTab` (`functions/index.js` line ~1174-1179 equivalent in `BOM.tsx`).

- [ ] **Step 1: Add `backfilledContactEmails` to the `Project` type**

In `src/utils/projectFirestore.ts`, add directly below the `externalRecipients?: ExternalRecipient[];` line, since Task 6/7's callables read/write this field:

```ts
  // Contacts already backfilled for this project (Communications Backfill) — see docs/superpowers/specs/2026-09-10-communications-backfill-design.md
  backfilledContactEmails?: string[];
```

- [ ] **Step 2: Update `ProjectCommunicationsTab.tsx`**

```tsx
// src/components/Project/ProjectCommunicationsTab.tsx
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Video, Mail, ExternalLink, Trash2, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { subscribeToMeetings, deleteProjectMeeting } from '@/utils/meetingFirestore';
import { subscribeToEmails, deleteProjectEmail } from '@/utils/emailFirestore';
import { mergeCommunications } from '@/utils/communicationsMerge';
import { addProjectBackfillStakeholders, subscribeToEmailBackfillJob } from '@/utils/communicationsBackfillFirestore';
import { BackfillCommunicationsDialog } from './BackfillCommunicationsDialog';
import type { ProjectMeeting } from '@/types/meeting';
import type { ProjectEmail } from '@/types/email';
import type { Project } from '@/utils/projectFirestore';
import type { EmailBackfillJobState } from '@/types/communicationsBackfill';

interface ProjectCommunicationsTabProps {
  projectId: string;
  project: Project;
  onProjectUpdated: (project: Project) => void;
}

export function ProjectCommunicationsTab({ projectId, project, onProjectUpdated }: ProjectCommunicationsTabProps) {
  const { toast } = useToast();
  const [meetings, setMeetings] = useState<ProjectMeeting[]>([]);
  const [emails, setEmails] = useState<ProjectEmail[]>([]);
  const [meetingsLoaded, setMeetingsLoaded] = useState(false);
  const [emailsLoaded, setEmailsLoaded] = useState(false);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillJob, setBackfillJob] = useState<EmailBackfillJobState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'email' | 'meeting'; id: string } | null>(null);

  useEffect(() => {
    setMeetingsLoaded(false);
    setEmailsLoaded(false);
    const unsubscribeMeetings = subscribeToMeetings(projectId, (m) => {
      setMeetings(m);
      setMeetingsLoaded(true);
    });
    const unsubscribeEmails = subscribeToEmails(projectId, (e) => {
      setEmails(e);
      setEmailsLoaded(true);
    });
    const unsubscribeBackfillJob = subscribeToEmailBackfillJob(projectId, setBackfillJob);
    return () => {
      unsubscribeMeetings();
      unsubscribeEmails();
      unsubscribeBackfillJob();
    };
  }, [projectId]);

  const handleBackfillConfirm = async (contacts: { email: string; name?: string }[]) => {
    try {
      await addProjectBackfillStakeholders(projectId, contacts);
      onProjectUpdated({
        ...project,
        externalRecipients: [
          ...(project.externalRecipients || []),
          ...contacts
            .filter((c) => !(project.externalRecipients || []).some((r) => r.email.toLowerCase() === c.email))
            .map((c) => ({ email: c.email, name: c.name || '', notificationsEnabled: false })),
        ],
      });
      toast({ title: 'Backfill started', description: `Searching the last 12 months for ${contacts.length} contact(s).` });
    } catch (error) {
      toast({ title: 'Failed to start backfill', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setBackfillOpen(false);
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!pendingDelete) return;
    try {
      if (pendingDelete.kind === 'email') {
        await deleteProjectEmail(projectId, pendingDelete.id);
      } else {
        await deleteProjectMeeting(projectId, pendingDelete.id);
      }
    } catch (error) {
      toast({ title: 'Failed to remove', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setPendingDelete(null);
    }
  };

  if (!meetingsLoaded || !emailsLoaded) {
    return <div className="text-sm text-muted-foreground py-8 text-center">Loading communications...</div>;
  }

  const items = mergeCommunications(meetings, emails);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => setBackfillOpen(true)}>
          <Users className="h-4 w-4 mr-2" /> Backfill Communications
        </Button>
        {backfillJob && backfillJob.status !== 'completed' && backfillJob.status !== 'failed' && (
          <p className="text-xs text-muted-foreground">
            Backfilling... {backfillJob.processedCount} messages scanned, {backfillJob.matchedCount} imported
          </p>
        )}
        {backfillJob && backfillJob.status === 'failed' && (
          <p className="text-xs text-destructive">Backfill failed: {backfillJob.error}</p>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Video className="h-10 w-10 mb-3 opacity-40" />
          <p className="text-sm">No meetings or emails captured yet for this project.</p>
        </div>
      ) : (
        items.map((item) => (
          item.kind === 'meeting' ? (
            <Card key={`meeting-${item.meeting.id}`}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Video className="h-4 w-4 text-muted-foreground shrink-0" />
                      <h4 className="font-medium truncate">{item.meeting.title || 'Untitled meeting'}</h4>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {item.meeting.startedAt.toLocaleString()}
                      {item.meeting.attendees.length > 0 && ' · '}
                      {item.meeting.attendees.map((a) => a.name || a.email).join(', ')}
                    </p>
                    {item.meeting.summary && (
                      <p className="text-sm mt-2 text-muted-foreground line-clamp-3">{item.meeting.summary}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.meeting.shareUrl && (
                      <a
                        href={item.meeting.shareUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        View recording <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setPendingDelete({ kind: 'meeting', id: item.meeting.id })}
                      aria-label="Remove meeting"
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card key={`email-${item.email.id}`}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                      <h4 className="font-medium truncate">{item.email.subject || '(no subject)'}</h4>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {item.email.sentAt.toLocaleString()} · {item.email.from.name || item.email.from.email} to{' '}
                      {item.email.to.map((t) => t.name || t.email).join(', ')}
                    </p>
                    <p className="text-sm mt-2 text-muted-foreground line-clamp-3">{item.email.body}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    onClick={() => setPendingDelete({ kind: 'email', id: item.email.id })}
                    aria-label="Remove email"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        ))
      )}

      <BackfillCommunicationsDialog
        open={backfillOpen}
        onOpenChange={setBackfillOpen}
        projectId={projectId}
        clientId={project.clientId}
        alreadyBackfilledEmails={project.backfilledContactEmails || []}
        onConfirm={handleBackfillConfirm}
      />

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this {pendingDelete?.kind}?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be removed from this project and won't be re-imported by future syncs or backfills.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirmed}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 3: Update `BOM.tsx`'s Communications tab render**

Replace `src/pages/BOM.tsx:1147-1149`:

```tsx
              {/* Communications Tab */}
              <TabsContent value="communications" className="mt-0">
                {projectId && fullProject && (
                  <ProjectCommunicationsTab
                    projectId={projectId}
                    project={fullProject}
                    onProjectUpdated={(updated) => setFullProject(updated)}
                  />
                )}
              </TabsContent>
```

- [ ] **Step 4: Typecheck and run existing tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no new errors, all tests pass

- [ ] **Step 5: Manual verification**

Run the app locally (`npm run dev`), open a project's Communications tab, confirm the "Backfill Communications" button renders and (with a connected Gmail account in a dev/test environment) the discovery → selection → confirmation flow completes without console errors, and that a trash icon appears on an existing captured email/meeting.

- [ ] **Step 6: Commit**

```bash
git add src/components/Project/ProjectCommunicationsTab.tsx src/pages/BOM.tsx src/utils/projectFirestore.ts
git commit -m "feat: wire backfill dialog, progress, and delete into the Communications tab"
```

---

### Task 15: Support-project visibility fix

**Files:**
- Modify: `src/pages/Projects.tsx:181-200`
- Test: `src/pages/__tests__/Projects.test.tsx` (new — no prior test file exists for this page; a focused test on the filtering logic only, not a full page render)

**Interfaces:**
- Consumes: `Project['supportProfile']` (existing field).
- Produces: no new exports — `filteredProjects`'s hidden-archived rule now has an exception. Since this logic lives inline in a `useMemo` inside the page component (not a separately exported pure function), this task extracts it to a small exported pure function so it's unit-testable without rendering the page.

- [ ] **Step 1: Write the failing test**

```tsx
// src/pages/__tests__/Projects.test.tsx
import { describe, expect, it } from 'vitest';
import { isProjectVisibleInList } from '../Projects';
import type { FirestoreProject } from '@/types/project';

const baseProject = { projectId: 'p1', projectName: 'Test', clientName: 'Acme', status: 'Ongoing' } as FirestoreProject;

describe('isProjectVisibleInList', () => {
  it('hides an archived project with no support profile', () => {
    expect(isProjectVisibleInList({ ...baseProject, status: 'Archived' })).toBe(false);
  });

  it('shows an archived project that has an active support profile', () => {
    expect(isProjectVisibleInList({ ...baseProject, status: 'Archived', supportProfile: { machines: [] } as never })).toBe(true);
  });

  it('shows a non-archived project regardless of support profile', () => {
    expect(isProjectVisibleInList({ ...baseProject, status: 'Ongoing' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/__tests__/Projects.test.tsx`
Expected: FAIL — `isProjectVisibleInList` is not exported from `../Projects`

- [ ] **Step 3: Extract and export the check, use it in the filter**

In `src/pages/Projects.tsx`, add this exported function above the `Projects` component (near the top of the file, after imports):

```tsx
/** An Archived project stays hidden from the list unless it has an active support profile (still reachable via Support). */
export const isProjectVisibleInList = (project: Pick<FirestoreProject, 'status' | 'supportProfile'>): boolean => {
  return project.status !== 'Archived' || !!project.supportProfile;
};
```

Replace the filter body (`src/pages/Projects.tsx:181-200`):

```tsx
  // Derive the filtered list only when data or filters change.
  // Archived projects are hidden by default, unless they're now in Support.
  const filteredProjects = useMemo(() => {
    const normalizedQuery = searchQuery.toLowerCase().trim();
    return projects.filter((project) => {
      if (!isProjectVisibleInList(project)) return false;

      const projectName = project.projectName?.toLowerCase() ?? "";
      const clientName = project.clientName?.toLowerCase() ?? "";
      const projectId = project.projectId?.toLowerCase() ?? "";

      const matchesSearch =
        projectName.includes(normalizedQuery) ||
        clientName.includes(normalizedQuery) ||
        projectId.includes(normalizedQuery);

      const matchesClient = clientFilter === "all" || project.clientName === clientFilter;
      const matchesStatus = statusFilter === "all" || project.status === statusFilter;
      return matchesSearch && matchesClient && matchesStatus;
    });
  }, [clientFilter, projects, searchQuery, statusFilter]);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/__tests__/Projects.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Typecheck and manual verification**

Run: `npx tsc --noEmit`
Expected: no new errors

Manually: in a dev/emulator environment, set a test project's `status` to `Archived` and give it a minimal `supportProfile` (e.g. via the Firestore emulator UI), confirm it now appears in `/projects`, and that its BOM page's Communications tab still opens normally.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Projects.tsx src/pages/__tests__/Projects.test.tsx
git commit -m "fix: keep archived projects with an active support profile visible in the project list"
```

---

## Self-Review Notes

- **Spec coverage:** §1-2 (directory + discovery job) → Tasks 1, 2, 4. §3-4 (picker UI + persisting stakeholders) → Tasks 9-13. §5 (backfill job) → Tasks 1, 2, 5, 6, 7. §6 (delete) → Tasks 8, 11, 14. §7 (support visibility) → Task 15. §8 (security/rules) → Task 3. §9 (error handling: needs_reconnect, job retry) → Task 12 (`not-connected` phase); a manual "Retry" affordance for a `failed` job is intentionally left as a follow-up — flipping `status: 'failed'` back to `'pending'` is a one-line admin action not yet surfaced in the UI, noted here rather than silently dropped.
- **Type consistency check:** `EmailBackfillJobState`/`ContactDiscoveryJobState` (Task 9) match the fields written by Tasks 4/6/7 and read by Task 11's subscriptions and Task 14's UI. `processGmailMessage`'s new boolean return (Task 5) is consumed only by Task 7; its existing caller in `syncOneGmailAccount` is unaffected. `project.backfilledContactEmails` is written by Tasks 6-7 and typed/read in Task 14.
- **Follow-up not in this plan:** a "Retry" button for a `failed` discovery/backfill job (spec Design §9) — flagged as a small, separate follow-up task once this plan ships, since it's a pure UI addition with no new backend surface (just writing `status: 'pending'`/`'scanning'` back onto an existing job doc).
