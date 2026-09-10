# Communications Backfill, Curation & Support Visibility (Sub-project 3)

## Status
Approved — ready for implementation planning

## Context

Sub-project 1 (`2026-09-08-fathom-meeting-capture-design.md`) and sub-project 2 (`2026-09-09-email-capture-design.md`, shipped) built live capture of meetings and emails into a project's Communications tab, matched automatically against `stakeholderIndex` (project `members`/`externalRecipients` + linked client CRM contacts). Sub-project 2 explicitly flagged historical backfill as a non-goal: "syncing a newly connected account starts from its connection time forward, not from years of prior mail... revisit if wrong."

This spec is that revisit, plus two related gaps identified while backfilling older projects:
- There's no way to remove an email/meeting that was captured but isn't actually relevant to the project.
- The Communications tab's visibility isn't tied to a project being in the Support module, so older projects that have since moved to Support may not show their (still-relevant) communications history.

## Goals

- Build a one-time, per-user contact directory by scanning the requesting admin's own connected Gmail mailbox (headers only) over the past 12 months, grouped by domain.
- Let an admin, per project, select which discovered contacts are that project's stakeholders — pre-filtered to the linked client's domain, with an expandable view of all other domains found.
- On confirmation (behind a second, explicit "this will search 12 months of mail" confirmation), backfill emails involving the selected contacts for the past 12 months into the project, using the same capture-scope guard, sanitization, and storage pipeline as live sync.
- Selected contacts are persisted as project stakeholders (`externalRecipients`), so live sync also picks up their mail going forward — backfill and live capture share one stakeholder set.
- Let a project member delete an email or meeting from the Communications tab when it isn't relevant; deleted items are never re-captured by a future sync or backfill run.
- Show the Communications tab for any project with an active support profile (`project.supportProfile` populated), regardless of project status.

## Non-goals

- Backfilling meetings — Fathom capture is webhook-based with no historical API; this spec covers email backfill only.
- Scanning any mailbox other than the requesting admin's own connected account (per-project or all-teammate scanning is a future extension).
- Attachments (unchanged from sub-project 2).
- Restoring a deleted email/meeting (delete is permanent; the exclusion marker is intentionally one-way).
- A generalized job-queue system (Cloud Tasks) — jobs are processed via chunked scheduled polling, matching the existing `syncGmailAccounts` pattern, to avoid introducing new infra for what is a low-volume, admin-initiated operation.

## Design

### 1. Contact directory (per user, reusable across projects)

`gmailContactDirectory/{uid}`:
```ts
interface GmailContactDirectory {
  contacts: {
    email: string;
    name?: string;
    domain: string;
    messageCount: number;
    lastSeenAt: Timestamp;
  }[];
  scannedFromDate: Timestamp;   // now - 365d, at time of scan
  lastScannedAt: Timestamp;
}
```
Built once per user and reused across every project's stakeholder picker; considered stale after 30 days (re-scan offered, not forced).

### 2. Discovery job (resumable, chunked)

`gmailContactDiscoveryJobs/{uid}`:
```ts
interface ContactDiscoveryJob {
  status: 'scanning' | 'ready' | 'failed';
  pageToken?: string;           // Gmail API list cursor
  accumulated: Record<string, { name?: string; count: number; lastSeenAt: Timestamp }>; // keyed by email
  sinceDate: Timestamp;
  error?: string;
  updatedAt: Timestamp;
}
```
`startContactDiscovery` (onCall) creates the job if absent/stale. A new scheduled function `processContactDiscoveryJobs` (`onSchedule`, ~5 min, same family as `syncGmailAccounts`) advances any `status: 'scanning'` job one Gmail `messages.list` page at a time (`format=metadata`, `metadataHeaders=[From,To,Cc]`), applying the same address-parsing helpers already in `emailIngestion.js` (`parseAddressList`), filtering out `INTERNAL_MAIL_DOMAINS`. On the last page, writes `gmailContactDirectory/{uid}` from `accumulated` and sets `status: 'ready'`. The dialog subscribes to the job doc for live progress.

### 3. Stakeholder selection UI

New dialog (opened from a "Backfill Communications" button on `ProjectCommunicationsTab.tsx`):
- If no fresh directory exists, shows discovery progress first.
- Once ready, renders two sections: contacts whose `domain` matches the project's linked client's email domain (expanded, default view), and a collapsible "Other domains" section grouped by domain (personal-mail domains listed individually, not grouped). Each row: checkbox, name/email, message count.
- Pre-checks anything already in `project.backfilledContactEmails`.
- "Continue" leads to a second, explicit confirmation step naming the exact contact count and the 12-month window, before anything is written — no backfill starts on the same click as selection.

### 4. Persisting stakeholders + queuing backfill

`addProjectBackfillStakeholders(projectId, emails[])` (onCall, project-member gated):
- Merges `emails` into `project.externalRecipients` (dedup by email) — this flows into `stakeholderIndex` via the existing `syncStakeholderIndex` trigger unchanged, so live sync starts covering these contacts immediately.
- Diffs `emails` against `project.backfilledContactEmails` to find genuinely new contacts.
- Upserts `emailBackfillJobs/{projectId}`, appending the new contacts to its queue (an existing in-progress job for the same project is extended rather than duplicated).

### 5. Backfill job (resumable, chunked, reuses live-capture pipeline)

`emailBackfillJobs/{projectId}`:
```ts
interface EmailBackfillJob {
  status: 'pending' | 'running' | 'completed' | 'failed';
  contacts: string[];           // emails queued for backfill
  completedContacts: string[];  // subset done so far
  sinceDate: Timestamp;         // now - 365d at time of last (re)start
  pageToken?: string;           // Gmail search cursor for the current contact batch
  processedCount: number;
  matchedCount: number;
  error?: string;
  updatedAt: Timestamp;
}
```
`processEmailBackfillJobs` (`onSchedule`, ~5-10 min): for each `pending`/`running` job, batches up to ~25 remaining contacts into one Gmail search query — `(from:a OR to:a OR from:b OR to:b ...) after:YYYY/MM/DD` — pages through results, and for each message: skip if `gmailIngestedMessages/{id}` exists (either already ingested or `excluded: true`), otherwise runs the **same** capture-scope-guard → `sanitizeEmailBody` → store-to-`projects/{id}/emails` logic already used by live sync (extracted as a shared helper if not already factored out), then writes the `gmailIngestedMessages/{id}` marker. Advances `pageToken`/`completedContacts` as it goes; marks a contact batch done and moves to the next when exhausted. On full completion: `project.backfilledContactEmails` is updated, job `status: 'completed'`.

On a Gmail API failure mid-job: `status: 'failed'` with `error` set, cursors preserved; a "Retry" action in the UI flips it back to `pending` so the scheduled processor resumes rather than restarting.

### 6. Delete / never-recapture

`deleteProjectEmail(projectId, messageId)` / `deleteProjectMeeting(projectId, meetingId)` (onCall, gated to project members — the same access level that can view the tab, not admin-only, since this is curation of a project's own data rather than cross-project triage):
- Deletes `projects/{projectId}/emails|meetings/{id}`.
- Sets `excluded: true` on `gmailIngestedMessages/{messageId}` or `fathomIngestedMeetings/{meetingId}` respectively (creating the marker doc if it doesn't already exist, e.g. for a meeting ingested before this field existed).

Both live sync (`processGmailMessage`, the Fathom webhook handler) and the new backfill processor check `excluded` on the marker before writing a message/meeting to any project, so a deleted item can never resurface.

UI: a trash icon on each Communications-tab card opens the existing `AlertDialog` confirm pattern (same shape as `ArchiveProjectDialog`) — "Remove this email from the project? It won't be re-imported." — before calling the delete callable.

### 7. Support-project visibility

Wherever the project detail view currently conditions which tabs render (to be located precisely during implementation planning), add: the Communications tab renders whenever `project.supportProfile` is populated, in addition to whatever condition already makes it render today — so a project that has moved into Support continues showing (and can still backfill/receive) its communications regardless of `status`.

### 8. Security

- `gmailContactDirectory`, `gmailContactDiscoveryJobs`, `emailBackfillJobs`: server-only collections, Firestore rules deny all client read/write (same pattern as `gmailConnections`/`stakeholderIndex`) — the UI only ever reads them via `onSnapshot` if rules allow read for the owning admin (directory/discovery-job are per-uid, so allow read where `request.auth.uid == uid`; `emailBackfillJobs` allow read for project members, same as the project's own subcollections), writes only via callables/scheduled functions (Admin SDK).
- `deleteProjectEmail`/`deleteProjectMeeting` re-check project membership server-side (never trust a client-supplied projectId/membership claim).
- No new OAuth scope — `gmail.readonly` (already granted) covers header/body reads for both discovery and backfill.

### 9. Error handling

- Gmail `needs_reconnect` status: "Backfill Communications" button disabled with a link to Settings (mirrors live sync's existing handling).
- Discovery/backfill jobs failing mid-run preserve cursors and surface a retry action rather than restarting from scratch.
- A message matched by the backfill search but failing the capture-scope guard (e.g., an internal-only thread that happened to CC a selected external contact... wait, guard requires an external participant which is guaranteed here) is simply not stored — logged at debug level only, not surfaced as an error.

### 10. Testing

- Unit tests: contact-extraction/domain-grouping (pure function over fixture headers), the `excluded` marker check on both live-sync and backfill code paths, Gmail search-query batching (contact list chunking).
- Firestore rules tests (extend `functions/firestoreRules.test.js`): new server-only job/directory collections, `deleteProjectEmail`/`deleteProjectMeeting` membership gating.
- Manual pass: connect a test Gmail account, run discovery, backfill a low-volume test project end-to-end, confirm dedup against live sync, confirm delete-then-resync (both live sync and re-running backfill) never resurrects a deleted item, confirm a project with a support profile but `Completed` status shows the tab.

## Decisions (resolved during brainstorming)

1. **Discovery scope** — scan only the requesting admin's own connected Gmail mailbox, not all teammates' (simplest, matches how the request was phrased; extendable later).
2. **Contact presentation** — pre-filtered to the project's linked client domain, with all other domains available in an expandable section.
3. **Delete semantics** — permanent delete of the stored doc + a persistent exclusion marker, so future sync/backfill runs never resurrect it.
4. **Support visibility gate** — `project.supportProfile` populated, independent of `status`.
5. **Backfill confirmation** — a second, explicit confirmation step (naming contact count + 12-month window) is required between selecting contacts and starting the backfill.
6. **Job execution mechanism** — chunked scheduled polling (same family as `syncGmailAccounts`), not Cloud Tasks — avoids new infra for a low-frequency, admin-initiated operation.
7. **Stakeholder persistence** — selected contacts are written into `project.externalRecipients`, unifying backfill and live-sync around the existing `stakeholderIndex` mechanism rather than a parallel one.
