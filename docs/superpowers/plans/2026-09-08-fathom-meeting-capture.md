# Fathom Meeting Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically capture Fathom meeting recordings into the right BOM-Tracker project by matching attendee emails against that project's existing stakeholders (`members` + `externalRecipients`), with a manual triage inbox for meetings that don't match exactly one project.

**Architecture:** A Svix-signed Fathom webhook lands on a new Cloud Function (`fathomMeetingWebhook`), which matches attendees against a denormalized `stakeholderIndex` collection kept in sync by a Firestore trigger (`syncStakeholderIndex`) on `projects/{projectId}`. A single match writes to `projects/{id}/meetings`; anything else goes to a top-level `unassignedMeetings` triage collection, resolved via two admin-gated callables and a KPI-dashboard card. A new "Meetings" tab on the project BOM page displays a project's captured meetings.

**Tech Stack:** Firebase Cloud Functions v2 (Node 22, CommonJS, `firebase-functions`, `firebase-admin`), Firestore, React + TypeScript (Vite), shadcn/ui, `node:test` for functions unit tests, Vitest for frontend unit tests.

**Spec:** `docs/superpowers/specs/2026-09-08-fathom-meeting-capture-design.md`

## Global Constraints

- No transcript storage — only `title`, `shareUrl`, `startedAt`/`endedAt`, `hostEmail`, `attendees`, `summary`, `actionItems` (spec Non-goals).
- `stakeholderIndex` is written only by the `syncStakeholderIndex` trigger — no client code writes to it, and no existing stakeholder CRUD function (`addProjectMember`, `removeProjectMember`, `addExternalRecipient`, `removeExternalRecipient`) is modified.
- Matching never guesses: zero or multiple project matches always go to `unassignedMeetings`, never auto-assigned (spec section 2).
- Meetings tab and its data use the same access control as the rest of a project (existing `projects/{projectId}/{subcollection=**}` Firestore rule already covers `projects/{id}/meetings` — no `firestore.rules` change needed).
- Follow existing code conventions: Cloud Functions pure logic lives in a separate required module with a sibling `*.test.js` (see `functions/supportEngineerFollowUp.js`); Firestore client utils convert `Timestamp` → `Date` on read via a local `toDate` helper (see `src/utils/poFirestore.ts`).

---

### Task 1: Svix signature verification + Fathom payload normalization

**Files:**
- Create: `functions/fathomMeeting.js`
- Test: `functions/fathomMeeting.test.js`

**Interfaces:**
- Produces: `verifySvixSignature({ id, timestamp, signatureHeader, rawBody, secret, toleranceSec, nowSec }) => boolean`, `computeSvixSignature({ id, timestamp, rawBody, secret }) => string` (test helper), `normalizeFathomPayload(body) => { fathomRecordingId, title, shareUrl, startedAt, endedAt, hostEmail, attendees: [{email, name}], summary, actionItems }`.

This ports the already-proven verification logic from `Pulse-UI---Goal-Tracking-Bot/services/fathomWebhook.js` (`verifySvixSignature`/`computeSvixSignature`), and adapts its `normalizeMeetingPayload` to BOM-Tracker's own field names (camelCase, no transcript field at all).

- [ ] **Step 1: Write the failing tests**

```js
// functions/fathomMeeting.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  verifySvixSignature,
  computeSvixSignature,
  normalizeFathomPayload,
} = require('./fathomMeeting');

test('verifySvixSignature accepts a correctly signed payload', () => {
  const secret = 'whsec_dGVzdHNlY3JldGtleWZvcnRlc3Rz';
  const id = 'msg_123';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = '{"recording_id":"rec_1"}';
  const signatureHeader = computeSvixSignature({ id, timestamp, rawBody, secret });

  assert.equal(
    verifySvixSignature({ id, timestamp, signatureHeader, rawBody, secret }),
    true
  );
});

test('verifySvixSignature rejects a tampered body', () => {
  const secret = 'whsec_dGVzdHNlY3JldGtleWZvcnRlc3Rz';
  const id = 'msg_123';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signatureHeader = computeSvixSignature({
    id, timestamp, rawBody: '{"recording_id":"rec_1"}', secret,
  });

  assert.equal(
    verifySvixSignature({
      id, timestamp, signatureHeader, rawBody: '{"recording_id":"rec_2"}', secret,
    }),
    false
  );
});

test('verifySvixSignature rejects a stale timestamp', () => {
  const secret = 'whsec_dGVzdHNlY3JldGtleWZvcnRlc3Rz';
  const id = 'msg_123';
  const timestamp = String(Math.floor(Date.now() / 1000) - 1000); // 1000s old, default tolerance 300s
  const rawBody = '{"recording_id":"rec_1"}';
  const signatureHeader = computeSvixSignature({ id, timestamp, rawBody, secret });

  assert.equal(
    verifySvixSignature({ id, timestamp, signatureHeader, rawBody, secret }),
    false
  );
});

test('verifySvixSignature rejects when any required field is missing', () => {
  assert.equal(
    verifySvixSignature({ id: '', timestamp: '1', signatureHeader: 'v1,x', rawBody: '{}', secret: 's' }),
    false
  );
});

test('normalizeFathomPayload maps Fathom native webhook fields', () => {
  const body = {
    recording_id: 12345,
    title: 'Weekly Sync',
    share_url: 'https://fathom.video/share/abc',
    recording_start_time: '2026-09-01T10:00:00Z',
    recording_end_time: '2026-09-01T10:30:00Z',
    recorded_by: { email: 'host@qualitastech.com' },
    calendar_invitees: [
      { name: 'Jane Client', email: 'jane@clientco.com' },
      { name: 'Host Person', email: 'host@qualitastech.com' },
    ],
    default_summary: { markdown_formatted: '## Notes\n- discussed timelines' },
    action_items: ['Send updated quote'],
  };

  const result = normalizeFathomPayload(body);

  assert.equal(result.fathomRecordingId, '12345');
  assert.equal(result.title, 'Weekly Sync');
  assert.equal(result.shareUrl, 'https://fathom.video/share/abc');
  assert.equal(result.startedAt, '2026-09-01T10:00:00Z');
  assert.equal(result.endedAt, '2026-09-01T10:30:00Z');
  assert.equal(result.hostEmail, 'host@qualitastech.com');
  assert.deepEqual(result.attendees, [
    { name: 'Jane Client', email: 'jane@clientco.com' },
    { name: 'Host Person', email: 'host@qualitastech.com' },
  ]);
  assert.equal(result.summary, '## Notes\n- discussed timelines');
  assert.deepEqual(result.actionItems, ['Send updated quote']);
});

test('normalizeFathomPayload handles a missing recording id', () => {
  const result = normalizeFathomPayload({});
  assert.equal(result.fathomRecordingId, '');
  assert.deepEqual(result.attendees, []);
  assert.deepEqual(result.actionItems, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test functions/fathomMeeting.test.js`
Expected: FAIL with `Cannot find module './fathomMeeting'`

- [ ] **Step 3: Implement `functions/fathomMeeting.js`**

```js
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

module.exports = {
  verifySvixSignature,
  computeSvixSignature,
  normalizeFathomPayload,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test functions/fathomMeeting.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/fathomMeeting.js functions/fathomMeeting.test.js
git commit -m "feat: add Fathom webhook signature verification and payload normalization"
```

---

### Task 2: Attendee-to-project matching + stakeholder diffing

**Files:**
- Modify: `functions/fathomMeeting.js`
- Test: `functions/fathomMeeting.test.js`

**Interfaces:**
- Consumes: nothing new from Task 1.
- Produces: `collectMatchedProjectIds(attendeeEmails, emailToProjectIds) => string[]`, `extractStakeholderEmails(projectData) => Set<string>`, `diffStakeholderEmails(beforeData, afterData) => { added: string[], removed: string[] }`.

These are the two pure pieces the webhook (Task 3) and the `stakeholderIndex` trigger (Task 4) build on. Keeping them here (rather than inline in `index.js`) keeps them unit-testable without Firestore, matching how `functions/supportEngineerFollowUp.js` is structured.

- [ ] **Step 1: Write the failing tests**

```js
// append to functions/fathomMeeting.test.js
const {
  collectMatchedProjectIds,
  extractStakeholderEmails,
  diffStakeholderEmails,
} = require('./fathomMeeting');

test('collectMatchedProjectIds unions and dedupes projects across attendees', () => {
  const index = {
    'jane@clientco.com': ['proj-1'],
    'bob@clientco.com': ['proj-1', 'proj-2'],
  };
  const result = collectMatchedProjectIds(['Jane@ClientCo.com', 'bob@clientco.com'], index);
  assert.deepEqual([...result].sort(), ['proj-1', 'proj-2']);
});

test('collectMatchedProjectIds returns empty for no matches', () => {
  const result = collectMatchedProjectIds(['nobody@nowhere.com'], {});
  assert.deepEqual(result, []);
});

test('collectMatchedProjectIds ignores blank/missing emails', () => {
  const result = collectMatchedProjectIds(['', undefined, null], { 'x@y.com': ['proj-1'] });
  assert.deepEqual(result, []);
});

test('extractStakeholderEmails collects lowercased emails from members and externalRecipients', () => {
  const emails = extractStakeholderEmails({
    members: [{ email: 'Alice@Qualitastech.com', userId: 'u1' }],
    externalRecipients: [{ email: 'jane@clientco.com', name: 'Jane' }],
  });
  assert.deepEqual([...emails].sort(), ['alice@qualitastech.com', 'jane@clientco.com']);
});

test('extractStakeholderEmails handles a project with neither field set', () => {
  assert.deepEqual([...extractStakeholderEmails({})], []);
  assert.deepEqual([...extractStakeholderEmails(undefined)], []);
});

test('diffStakeholderEmails reports added and removed emails', () => {
  const before = { externalRecipients: [{ email: 'jane@clientco.com', name: 'Jane' }] };
  const after = {
    externalRecipients: [
      { email: 'jane@clientco.com', name: 'Jane' },
      { email: 'bob@clientco.com', name: 'Bob' },
    ],
  };
  const { added, removed } = diffStakeholderEmails(before, after);
  assert.deepEqual(added, ['bob@clientco.com']);
  assert.deepEqual(removed, []);
});

test('diffStakeholderEmails reports removals when a stakeholder is dropped', () => {
  const before = { members: [{ email: 'alice@qt.com', userId: 'u1' }] };
  const after = {};
  const { added, removed } = diffStakeholderEmails(before, after);
  assert.deepEqual(added, []);
  assert.deepEqual(removed, ['alice@qt.com']);
});

test('diffStakeholderEmails is a no-op when nothing changed', () => {
  const project = { members: [{ email: 'alice@qt.com', userId: 'u1' }] };
  const { added, removed } = diffStakeholderEmails(project, project);
  assert.deepEqual(added, []);
  assert.deepEqual(removed, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test functions/fathomMeeting.test.js`
Expected: FAIL — `collectMatchedProjectIds is not a function` (and similarly for the other two)

- [ ] **Step 3: Implement the matching and diffing functions**

Append to `functions/fathomMeeting.js`, before the `module.exports` block:

```js
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

/** Lowercased, deduped set of a project's stakeholder emails (members + externalRecipients). */
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
 * Diff two project docs' stakeholder email sets (before/after a write), for
 * the syncStakeholderIndex trigger to apply as targeted stakeholderIndex updates.
 */
function diffStakeholderEmails(beforeData, afterData) {
  const before = extractStakeholderEmails(beforeData);
  const after = extractStakeholderEmails(afterData);
  const added = [...after].filter((e) => !before.has(e));
  const removed = [...before].filter((e) => !after.has(e));
  return { added, removed };
}
```

Update `module.exports` to include the three new functions:

```js
module.exports = {
  verifySvixSignature,
  computeSvixSignature,
  normalizeFathomPayload,
  collectMatchedProjectIds,
  extractStakeholderEmails,
  diffStakeholderEmails,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test functions/fathomMeeting.test.js`
Expected: PASS (13 tests total)

- [ ] **Step 5: Commit**

```bash
git add functions/fathomMeeting.js functions/fathomMeeting.test.js
git commit -m "feat: add attendee-to-project matching and stakeholder diffing"
```

---

### Task 3: `syncStakeholderIndex` Firestore trigger

**Files:**
- Modify: `functions/index.js`

**Interfaces:**
- Consumes: `diffStakeholderEmails` from Task 2 (`require('./fathomMeeting')`).
- Produces: `exports.syncStakeholderIndex` (Firestore trigger, no direct consumers — it's infrastructure Task 5's webhook reads via the `stakeholderIndex` collection).

Wires the diffing logic from Task 2 into a live trigger, following the exact pattern `onBOMUpdate` (functions/index.js:3710) already uses for `onDocumentWritten`. Runs on every write to a project doc; applies only the added/removed emails as targeted `stakeholderIndex/{email}` updates (not a full rebuild), same efficiency principle as the rest of that trigger family.

- [ ] **Step 1: Add the require and the trigger**

In `functions/index.js`, add near the other local requires (next to the `supportEngineerFollowUp` require, ~line 29):

```js
const { diffStakeholderEmails } = require('./fathomMeeting');
```

Add the trigger, right after `exports.onBOMUpdate` (after line 3975's PDF export, or any point after `onBOMUpdate` — place it directly below `onBOMUpdate`'s closing `});` for locality with the other Firestore trigger):

```js
/**
 * Firestore trigger: keep stakeholderIndex/{email} -> { projectIds } in sync
 * with each project's members + externalRecipients, so the Fathom webhook can
 * look up "which project(s) is this attendee a stakeholder of" in O(1) reads
 * instead of scanning every project. Fires on every write to projects/{projectId};
 * only the emails that actually changed are touched.
 */
exports.syncStakeholderIndex = onDocumentWritten(
  { document: 'projects/{projectId}' },
  async (event) => {
    const projectId = event.params.projectId;
    const beforeData = event.data?.before?.data();
    const afterData = event.data?.after?.data();

    const { added, removed } = diffStakeholderEmails(beforeData, afterData);
    if (added.length === 0 && removed.length === 0) return;

    const db = admin.firestore();
    const indexCol = db.collection('stakeholderIndex');

    await Promise.all([
      ...added.map(async (email) => {
        const ref = indexCol.doc(email);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const projectIds = new Set(snap.exists ? snap.data().projectIds || [] : []);
          projectIds.add(projectId);
          tx.set(ref, { projectIds: [...projectIds] });
        });
      }),
      ...removed.map(async (email) => {
        const ref = indexCol.doc(email);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return;
          const projectIds = new Set(snap.data().projectIds || []);
          projectIds.delete(projectId);
          if (projectIds.size === 0) {
            tx.delete(ref);
          } else {
            tx.set(ref, { projectIds: [...projectIds] });
          }
        });
      }),
    ]);

    logger.info('syncStakeholderIndex updated', { projectId, added, removed });
  }
);
```

`stakeholderIndex/{email}` doc ids are raw email strings, which contain characters (`.`, `@`) that are all valid in Firestore document ids — no encoding needed (Firestore only disallows `/` and a couple of reserved names, neither of which appears in an email address).

- [ ] **Step 2: Lint**

Run: `cd functions && npx eslint index.js`
Expected: no new errors (existing pre-existing errors, if any, are unrelated to this change — compare against `git stash` if unsure)

- [ ] **Step 3: Manual verification against the emulator**

Run: `firebase emulators:start --only functions,firestore`, then in the emulator UI create a project doc with `externalRecipients: [{email: "test@example.com", name: "Test"}]`, and confirm `stakeholderIndex/test@example.com` appears with `projectIds: ["<projectId>"]`. Edit the project to remove that recipient and confirm the index doc is deleted.

- [ ] **Step 4: Commit**

```bash
git add functions/index.js
git commit -m "feat: sync stakeholderIndex from project members/externalRecipients"
```

---

### Task 4: `fathomMeetingWebhook` ingestion function

**Files:**
- Modify: `functions/index.js`

**Interfaces:**
- Consumes: `verifySvixSignature`, `normalizeFathomPayload`, `collectMatchedProjectIds` from `functions/fathomMeeting.js` (Tasks 1-2).
- Produces: `exports.fathomMeetingWebhook` (HTTPS endpoint). Writes to `projects/{id}/meetings/{fathomRecordingId}` (single match) or `unassignedMeetings/{fathomRecordingId}` (zero/multiple matches) — these are the collections Tasks 6-9 read from.

Dedup uses a lightweight marker collection (`fathomIngestedMeetings/{recordingId}`) rather than a query, avoiding any new Firestore index requirement.

- [ ] **Step 1: Add the secret and requires**

Near the other `defineSecret` calls (~line 43, after `pulseApiKey`):

```js
const fathomWebhookSecret = defineSecret('FATHOM_WEBHOOK_SECRET');
```

Update the Task 3 require line to also pull in the Task 1/2 functions:

```js
const {
  diffStakeholderEmails,
  verifySvixSignature,
  normalizeFathomPayload,
  collectMatchedProjectIds,
} = require('./fathomMeeting');
```

- [ ] **Step 2: Add the webhook function**

Add directly below `exports.syncStakeholderIndex` from Task 3:

```js
/**
 * Fathom "new meeting content ready" webhook. Verifies the Svix signature,
 * normalizes the payload, matches attendees against stakeholderIndex, and
 * files the meeting under the single matched project or into
 * unassignedMeetings for manual triage. No transcript is stored.
 */
exports.fathomMeetingWebhook = onRequest(
  { secrets: [fathomWebhookSecret] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
    const valid = verifySvixSignature({
      id: req.get('webhook-id'),
      timestamp: req.get('webhook-timestamp'),
      signatureHeader: req.get('webhook-signature'),
      rawBody,
      secret: fathomWebhookSecret.value(),
    });

    if (!valid) {
      logger.warn('fathomMeetingWebhook: invalid or missing signature');
      res.status(401).send('Invalid signature');
      return;
    }

    const meeting = normalizeFathomPayload(req.body);
    if (!meeting.fathomRecordingId) {
      res.status(400).send('Missing recording id');
      return;
    }

    const db = admin.firestore();
    const dedupRef = db.collection('fathomIngestedMeetings').doc(meeting.fathomRecordingId);
    const dedupSnap = await dedupRef.get();
    if (dedupSnap.exists) {
      logger.info('fathomMeetingWebhook: already ingested, skipping', {
        fathomRecordingId: meeting.fathomRecordingId,
      });
      res.status(200).send('Already ingested');
      return;
    }

    const attendeeEmails = meeting.attendees.map((a) => a.email);
    const lookups = await Promise.all(
      [...new Set(attendeeEmails.map((e) => String(e || '').toLowerCase().trim()).filter(Boolean))]
        .map(async (email) => {
          const snap = await db.collection('stakeholderIndex').doc(email).get();
          return [email, snap.exists ? snap.data().projectIds || [] : []];
        })
    );
    const emailToProjectIds = Object.fromEntries(lookups);
    const matchedProjectIds = collectMatchedProjectIds(attendeeEmails, emailToProjectIds);

    const baseDoc = {
      fathomRecordingId: meeting.fathomRecordingId,
      title: meeting.title,
      shareUrl: meeting.shareUrl,
      startedAt: meeting.startedAt ? new Date(meeting.startedAt) : admin.firestore.FieldValue.serverTimestamp(),
      endedAt: meeting.endedAt ? new Date(meeting.endedAt) : admin.firestore.FieldValue.serverTimestamp(),
      hostEmail: meeting.hostEmail,
      attendees: meeting.attendees,
      summary: meeting.summary,
      actionItems: meeting.actionItems,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (matchedProjectIds.length === 1) {
      const [projectId] = matchedProjectIds;
      await db
        .collection('projects')
        .doc(projectId)
        .collection('meetings')
        .doc(meeting.fathomRecordingId)
        .set({ ...baseDoc, matchedStakeholderEmails: attendeeEmails });
      logger.info('fathomMeetingWebhook: matched to project', { projectId, fathomRecordingId: meeting.fathomRecordingId });
    } else {
      await db
        .collection('unassignedMeetings')
        .doc(meeting.fathomRecordingId)
        .set({ ...baseDoc, candidateProjectIds: matchedProjectIds });
      logger.info('fathomMeetingWebhook: unassigned', {
        candidateCount: matchedProjectIds.length,
        fathomRecordingId: meeting.fathomRecordingId,
      });
    }

    await dedupRef.set({ ingestedAt: admin.firestore.FieldValue.serverTimestamp() });
    res.status(200).send('OK');
  }
);
```

- [ ] **Step 3: Lint**

Run: `cd functions && npx eslint index.js`
Expected: no new errors

- [ ] **Step 4: Manual verification against the emulator**

With the emulator running (Task 3's Step 3 setup still up), POST a signed test request:

```bash
node -e "
const { computeSvixSignature } = require('./functions/fathomMeeting');
const body = JSON.stringify({
  recording_id: 999,
  title: 'Test Meeting',
  share_url: 'https://fathom.video/share/test',
  recording_start_time: new Date().toISOString(),
  recording_end_time: new Date().toISOString(),
  recorded_by: { email: 'host@qualitastech.com' },
  calendar_invitees: [{ name: 'Test', email: 'test@example.com' }],
  default_summary: { markdown_formatted: 'Test summary' },
  action_items: [],
});
const id = 'msg_test';
const timestamp = String(Math.floor(Date.now()/1000));
const secret = 'whsec_dGVzdHNlY3JldGtleWZvcnRlc3Rz';
const sig = computeSvixSignature({ id, timestamp, rawBody: body, secret });
console.log(JSON.stringify({ id, timestamp, sig, body }));
"
```

Use the printed `id`/`timestamp`/`sig`/`body` to `curl` the emulator's local `fathomMeetingWebhook` URL with headers `webhook-id`, `webhook-timestamp`, `webhook-signature`, setting the emulator's `FATHOM_WEBHOOK_SECRET` to the same test secret. Confirm the meeting lands in `unassignedMeetings/999` (since `test@example.com` isn't a stakeholder of any emulator project yet), then re-run and confirm the second call is skipped (`Already ingested`).

- [ ] **Step 5: Commit**

```bash
git add functions/index.js
git commit -m "feat: add fathomMeetingWebhook ingestion function"
```

---

### Task 5: Triage callables — `assignUnassignedMeeting` / `discardUnassignedMeeting`

**Files:**
- Modify: `functions/index.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `exports.assignUnassignedMeeting` (callable: `{ meetingId: string, projectId: string }` → `{ success: true }`), `exports.discardUnassignedMeeting` (callable: `{ meetingId: string }` → `{ success: true }`). Task 8's `src/utils/meetingFirestore.ts` calls both by name via `httpsCallable`.

Admin gate follows the exact pattern `manageUserStatus` (functions/index.js:411) already uses — re-verify via `admin.auth().getUser`, not just the token claims, for consistency with the rest of the admin-callable family.

- [ ] **Step 1: Add the two callables**

Add directly below `exports.fathomMeetingWebhook` from Task 4:

```js
/** Move an unassigned meeting into a project's meetings subcollection. Admin only. */
exports.assignUnassignedMeeting = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) {
    throw new Error('Authentication required');
  }
  const callerRecord = await admin.auth().getUser(auth.uid);
  const callerClaims = callerRecord.customClaims || {};
  if (callerClaims.role !== 'admin' || callerClaims.status !== 'approved') {
    throw new Error('Admin privileges required');
  }

  const { meetingId, projectId } = data;
  if (!meetingId || !projectId) {
    throw new Error('meetingId and projectId are required');
  }

  const db = admin.firestore();
  const unassignedRef = db.collection('unassignedMeetings').doc(meetingId);
  const snap = await unassignedRef.get();
  if (!snap.exists) {
    throw new Error('Meeting not found');
  }
  const { candidateProjectIds, ...meetingData } = snap.data();
  const projectMeetingRef = db.collection('projects').doc(projectId).collection('meetings').doc(meetingId);

  await db.runTransaction(async (tx) => {
    tx.set(projectMeetingRef, {
      ...meetingData,
      matchedStakeholderEmails: meetingData.attendees?.map((a) => a.email) || [],
    });
    tx.delete(unassignedRef);
  });

  logger.info('assignUnassignedMeeting: assigned', { meetingId, projectId, by: auth.uid });
  return { success: true };
});

/** Discard an unassigned meeting that isn't actually project-related. Admin only. */
exports.discardUnassignedMeeting = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) {
    throw new Error('Authentication required');
  }
  const callerRecord = await admin.auth().getUser(auth.uid);
  const callerClaims = callerRecord.customClaims || {};
  if (callerClaims.role !== 'admin' || callerClaims.status !== 'approved') {
    throw new Error('Admin privileges required');
  }

  const { meetingId } = data;
  if (!meetingId) {
    throw new Error('meetingId is required');
  }

  await admin.firestore().collection('unassignedMeetings').doc(meetingId).delete();
  logger.info('discardUnassignedMeeting: discarded', { meetingId, by: auth.uid });
  return { success: true };
});
```

- [ ] **Step 2: Lint**

Run: `cd functions && npx eslint index.js`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add functions/index.js
git commit -m "feat: add assignUnassignedMeeting and discardUnassignedMeeting callables"
```

---

### Task 6: Frontend meeting types

**Files:**
- Create: `src/types/meeting.ts`

**Interfaces:**
- Produces: `MeetingAttendee`, `ProjectMeeting`, `UnassignedMeeting` — consumed by Task 7 (`meetingFirestore.ts`), Task 8 (`ProjectMeetingsTab.tsx`), and Task 9 (`Index.tsx`).

- [ ] **Step 1: Write the file**

```ts
// src/types/meeting.ts
export interface MeetingAttendee {
  email: string;
  name?: string;
}

export interface ProjectMeeting {
  id: string;
  fathomRecordingId: string;
  title: string;
  shareUrl: string;
  startedAt: Date;
  endedAt: Date;
  hostEmail: string;
  attendees: MeetingAttendee[];
  summary: string;
  actionItems: string[];
  matchedStakeholderEmails: string[];
  createdAt: Date;
}

/** A meeting with zero or multiple stakeholder matches, awaiting manual triage. */
export interface UnassignedMeeting extends Omit<ProjectMeeting, 'matchedStakeholderEmails'> {
  candidateProjectIds: string[];
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no new errors (this file has no consumers yet, so it can only add errors if it's malformed)

- [ ] **Step 3: Commit**

```bash
git add src/types/meeting.ts
git commit -m "feat: add ProjectMeeting/UnassignedMeeting types"
```

---

### Task 7: `src/utils/meetingFirestore.ts`

**Files:**
- Create: `src/utils/meetingFirestore.ts`

**Interfaces:**
- Consumes: `ProjectMeeting`, `UnassignedMeeting` from Task 6; `db`, `functions` from `@/firebase`.
- Produces: `subscribeToMeetings(projectId, callback) => Unsubscribe`, `getUnassignedMeetings() => Promise<UnassignedMeeting[]>`, `assignUnassignedMeeting(meetingId, projectId) => Promise<void>`, `discardUnassignedMeeting(meetingId) => Promise<void>`. Consumed by Task 8 (`subscribeToMeetings`) and Task 9 (the other three).

Follows `src/utils/poFirestore.ts`'s `toDate`/`mapXDocument` convention.

- [ ] **Step 1: Write the file**

```ts
// src/utils/meetingFirestore.ts
import { db, functions } from "@/firebase";
import {
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import type { ProjectMeeting, UnassignedMeeting, MeetingAttendee } from "@/types/meeting";

const toDate = (value: Timestamp | Date | undefined): Date | undefined => {
  if (!value) return undefined;
  return value instanceof Timestamp ? value.toDate() : value;
};

const mapMeetingDocument = (id: string, data: Record<string, unknown>): ProjectMeeting => ({
  id,
  fathomRecordingId: (data.fathomRecordingId as string) || '',
  title: (data.title as string) || '',
  shareUrl: (data.shareUrl as string) || '',
  startedAt: toDate(data.startedAt as Timestamp | Date | undefined) || new Date(),
  endedAt: toDate(data.endedAt as Timestamp | Date | undefined) || new Date(),
  hostEmail: (data.hostEmail as string) || '',
  attendees: (data.attendees as MeetingAttendee[]) || [],
  summary: (data.summary as string) || '',
  actionItems: (data.actionItems as string[]) || [],
  matchedStakeholderEmails: (data.matchedStakeholderEmails as string[]) || [],
  createdAt: toDate(data.createdAt as Timestamp | Date | undefined) || new Date(),
});

/** Live-subscribe to a project's captured meetings, newest first. */
export const subscribeToMeetings = (
  projectId: string,
  callback: (meetings: ProjectMeeting[]) => void
): Unsubscribe => {
  const q = query(collection(db, "projects", projectId, "meetings"), orderBy("startedAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    callback(snapshot.docs.map((d) => mapMeetingDocument(d.id, d.data())));
  });
};

/** One-shot fetch of meetings awaiting manual project assignment. */
export const getUnassignedMeetings = async (): Promise<UnassignedMeeting[]> => {
  const snapshot = await getDocs(collection(db, "unassignedMeetings"));
  return snapshot.docs.map((d) => {
    const data = d.data();
    const { matchedStakeholderEmails: _omit, ...rest } = mapMeetingDocument(d.id, data);
    return {
      ...rest,
      candidateProjectIds: (data.candidateProjectIds as string[]) || [],
    };
  });
};

/** Admin-only: move an unassigned meeting into a project. */
export const assignUnassignedMeeting = async (meetingId: string, projectId: string): Promise<void> => {
  const fn = httpsCallable(functions, 'assignUnassignedMeeting');
  await fn({ meetingId, projectId });
};

/** Admin-only: discard an unassigned meeting that isn't project-related. */
export const discardUnassignedMeeting = async (meetingId: string): Promise<void> => {
  const fn = httpsCallable(functions, 'discardUnassignedMeeting');
  await fn({ meetingId });
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no new errors

- [ ] **Step 3: Commit**

```bash
git add src/utils/meetingFirestore.ts
git commit -m "feat: add meetingFirestore client utils"
```

---

### Task 8: `ProjectMeetingsTab` + BOM page wiring

**Files:**
- Create: `src/components/Project/ProjectMeetingsTab.tsx`
- Modify: `src/pages/BOM.tsx`

**Interfaces:**
- Consumes: `subscribeToMeetings` from Task 7; `ProjectMeeting` from Task 6.
- Produces: `ProjectMeetingsTab({ projectId }: { projectId: string })` component, wired into BOM.tsx's existing `Tabs`.

Mirrors the existing `!isPartner` gating already used for Milestones/Context/Members (BOM.tsx:735-755) — meeting summaries can contain sensitive discussion, so partners don't get this tab, matching the spec's "same access control as the rest of the project" for internal users.

- [ ] **Step 1: Write `ProjectMeetingsTab.tsx`**

```tsx
// src/components/Project/ProjectMeetingsTab.tsx
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Video, ExternalLink } from 'lucide-react';
import { subscribeToMeetings } from '@/utils/meetingFirestore';
import type { ProjectMeeting } from '@/types/meeting';

interface ProjectMeetingsTabProps {
  projectId: string;
}

export function ProjectMeetingsTab({ projectId }: ProjectMeetingsTabProps) {
  const [meetings, setMeetings] = useState<ProjectMeeting[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeToMeetings(projectId, (m) => {
      setMeetings(m);
      setLoading(false);
    });
    return unsubscribe;
  }, [projectId]);

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">Loading meetings...</div>;
  }

  if (meetings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Video className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm">No meetings captured yet for this project.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {meetings.map((meeting) => (
        <Card key={meeting.id}>
          <CardContent className="pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h4 className="font-medium truncate">{meeting.title || 'Untitled meeting'}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {meeting.startedAt.toLocaleString()}
                  {meeting.attendees.length > 0 && ' · '}
                  {meeting.attendees.map((a) => a.name || a.email).join(', ')}
                </p>
                {meeting.summary && (
                  <p className="text-sm mt-2 text-muted-foreground line-clamp-3">{meeting.summary}</p>
                )}
              </div>
              {meeting.shareUrl && (
                <a
                  href={meeting.shareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  View recording <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Wire the tab into `src/pages/BOM.tsx`**

Add the import near the other `Project` component imports:

```tsx
import { ProjectMeetingsTab } from '@/components/Project/ProjectMeetingsTab';
```

Add a `Video` icon to the existing `lucide-react` import line if not already present.

Change the non-partner `TabsList` grid from 6 to 7 columns (BOM.tsx:709):

```tsx
<TabsList className={`grid w-full mb-4 ${isPartner ? 'grid-cols-3' : 'grid-cols-7'}`}>
```

Add a new trigger, immediately after the `documents` trigger and before the `!isPartner` milestones trigger (BOM.tsx:734, before line 735):

```tsx
{!isPartner && (
  <TabsTrigger value="meetings" className="flex items-center gap-2">
    <Video size={16} />
    Meetings
  </TabsTrigger>
)}
```

Add the matching `TabsContent`, right after the `documents` TabsContent closes (BOM.tsx:1137, before the `{/* Context Tab */}` comment):

```tsx
{/* Meetings Tab */}
<TabsContent value="meetings" className="mt-0">
  {projectId && <ProjectMeetingsTab projectId={projectId} />}
</TabsContent>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no new errors

- [ ] **Step 4: Manual verification**

Run `npm run dev`, open a project's BOM page, confirm a "Meetings" tab appears (non-partner view only) showing the empty state; manually add a test doc to `projects/{id}/meetings` in the Firebase console and confirm it renders with title/date/attendees/summary and a working "View recording" link.

- [ ] **Step 5: Commit**

```bash
git add src/components/Project/ProjectMeetingsTab.tsx src/pages/BOM.tsx
git commit -m "feat: add project Meetings tab"
```

---

### Task 9: Unassigned Meetings dashboard card

**Files:**
- Modify: `src/pages/Index.tsx`

**Interfaces:**
- Consumes: `getUnassignedMeetings`, `assignUnassignedMeeting`, `discardUnassignedMeeting` from Task 7; `UnassignedMeeting` from Task 6; the page's existing `projects` state (already loaded) for the assignment picker.

The whole `Index.tsx` page is already gated behind `if (!user || !user.isAdmin) return ...` (Index.tsx:199), so no separate admin check is needed for this section — it inherits the page's existing gate, matching the spec decision.

- [ ] **Step 1: Add imports, state, and the fetch**

Add near the other utils imports:

```tsx
import { getUnassignedMeetings, assignUnassignedMeeting, discardUnassignedMeeting } from "@/utils/meetingFirestore";
import type { UnassignedMeeting } from "@/types/meeting";
import { Video } from "lucide-react";
```

Add state near `pendingUsers` (Index.tsx:71):

```tsx
const [unassignedMeetings, setUnassignedMeetings] = useState<UnassignedMeeting[]>([]);
const [resolvingMeetingId, setResolvingMeetingId] = useState<string | null>(null);
```

Add the fetch in `fetchKPIData`, alongside the existing "Pending user account approvals" block (Index.tsx:171-177):

```tsx
// Meetings needing manual project assignment
try {
  const unassigned = await getUnassignedMeetings();
  setUnassignedMeetings(unassigned);
} catch (error) {
  console.error('Error fetching unassigned meetings:', error);
}
```

- [ ] **Step 2: Add the handlers**

Add near the other handlers in the component body:

```tsx
const handleAssignMeeting = async (meetingId: string, projectId: string) => {
  setResolvingMeetingId(meetingId);
  try {
    await assignUnassignedMeeting(meetingId, projectId);
    setUnassignedMeetings((prev) => prev.filter((m) => m.id !== meetingId));
  } catch (error) {
    console.error('Error assigning meeting:', error);
  } finally {
    setResolvingMeetingId(null);
  }
};

const handleDiscardMeeting = async (meetingId: string) => {
  setResolvingMeetingId(meetingId);
  try {
    await discardUnassignedMeeting(meetingId);
    setUnassignedMeetings((prev) => prev.filter((m) => m.id !== meetingId));
  } catch (error) {
    console.error('Error discarding meeting:', error);
  } finally {
    setResolvingMeetingId(null);
  }
};
```

- [ ] **Step 3: Add the `Select` import and render the section**

Add the shadcn Select import:

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
```

Update the "all caught up" condition (Index.tsx:375) to include the new source:

```tsx
{pendingClaims.count === 0 && pendingPOApprovals.count === 0 && pendingUsers.length === 0 && unassignedMeetings.length === 0 ? (
```

Add a new block inside the `Needs Attention` card content, after the `pendingUsers` block closes (Index.tsx, right after line 457's closing `)}`):

```tsx
{unassignedMeetings.length > 0 && (
  <div>
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Video className="h-4 w-4 text-amber-600" />
        Meetings Needing Assignment
      </div>
      <Badge variant="outline" className="bg-amber-50 text-amber-700">
        {unassignedMeetings.length}
      </Badge>
    </div>
    <div className="space-y-2">
      {unassignedMeetings.map((meeting) => (
        <div key={meeting.id} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded border">
          <span className="flex-1 truncate" title={meeting.title}>
            {meeting.title || 'Untitled meeting'}
          </span>
          <Select
            disabled={resolvingMeetingId === meeting.id}
            onValueChange={(projectId) => handleAssignMeeting(meeting.id, projectId)}
          >
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue placeholder="Assign to..." />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.projectName || p.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            disabled={resolvingMeetingId === meeting.id}
            onClick={() => handleDiscardMeeting(meeting.id)}
          >
            Discard
          </Button>
        </div>
      ))}
    </div>
  </div>
)}
```

This reads `projects` (the page's already-loaded project list, `id`/`projectName` fields per the existing `projectsData` shape at Index.tsx:88-95) and `Button` (already imported for the page's other actions) — no new dependency beyond `Select`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no new errors

- [ ] **Step 5: Manual verification**

With a test doc manually added to `unassignedMeetings` in the Firebase console, load the dashboard, confirm the "Meetings Needing Assignment" row appears with a working project picker and Discard button, and that both actions remove the row and the underlying Firestore doc.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Index.tsx
git commit -m "feat: add unassigned meetings triage to KPI dashboard"
```

---

### Task 10: Deploy and activate

**Files:** none (operational)

- [ ] **Step 1: Deploy the new functions**

```bash
firebase deploy --only functions:syncStakeholderIndex,functions:fathomMeetingWebhook,functions:assignUnassignedMeeting,functions:discardUnassignedMeeting
```

- [ ] **Step 2: Set the webhook secret**

```bash
firebase functions:secrets:set FATHOM_WEBHOOK_SECRET
```
Paste in a newly generated Fathom webhook signing secret (not the same value Pulse's still-inactive webhook uses — see Task 4's dedup design note: each Fathom webhook destination gets its own secret).

- [ ] **Step 3: Deploy hosting**

```bash
npm run build && firebase deploy --only hosting
```

- [ ] **Step 4: Create the Fathom webhook**

In the Fathom account's webhook settings, create a new webhook pointed at the deployed `fathomMeetingWebhook` URL (from the Task 10 Step 1 deploy output, or `firebase functions:log` / the Cloud Console), for the "new meeting content ready" event. Confirm Fathom's test-delivery button produces a 200 and a corresponding doc in `unassignedMeetings` (first delivery — no project has any real stakeholder overlap with a test meeting yet) or `projects/{id}/meetings` (if a real meeting whose attendees are already stakeholders arrives).

- [ ] **Step 5: Verify end-to-end with a real meeting**

Have an actual Fathom-recorded call with a project's stakeholder happen (or ask a teammate to trigger one), confirm it appears on that project's Meetings tab within a minute or two of the recording finishing.
