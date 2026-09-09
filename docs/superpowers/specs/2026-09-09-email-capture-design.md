# Email Capture (Communications Tracking, Sub-project 2 of 2)

## Status
Approved — ready for implementation planning

## Context

Sub-project 1 (`docs/superpowers/specs/2026-09-08-fathom-meeting-capture-design.md`, shipped and deployed) built Fathom meeting capture and, along the way, unified project stakeholder matching against `stakeholderIndex` (project `members`/`externalRecipients` plus every linked client's active CRM contacts). That spec explicitly deferred email capture as "sub-project 2."

The user asked for this to work "similar to Pulse" (`Pulse-UI---Goal-Tracking-Bot`). Investigation of Pulse's actual email pipeline found:

- Pulse connects **individual teammates' Gmail accounts via per-user OAuth** (`gmail_accounts` table: refresh token, per account), not a shared/forwarding mailbox or a push webhook.
- A `/gmail/sync` endpoint **polls** the Gmail API per connected account for new messages, storing `{gmail_message_id, from_email, to_email, subject, received_at, summary, lead_id, direction}`.
- Matching to a deal (`services/emailStakeholders.js`) compares message participant email domains against the deal's known contact domain, with an explicit guard: `INTERNAL_MAIL_DOMAINS` and `PERSONAL_MAIL_DOMAINS` are never treated as a deal's own domain, specifically because a generic mailbox (e.g. `sales@`) getting mistaken for a deal's own contact caused a real incident (Aug 2026, "Toyota Connected," project 2177 mass-misattribution — every unrelated email CC'ing that mailbox got wrongly attributed to one deal).
- Pulse stores an AI **summary**, not the full body.

BOM-Tracker's requirements diverge from a straight copy on two points, decided during brainstorming:
- **Full current-message body**, not a summary — sanitized to strip quoted reply history (so re-storing a thread doesn't duplicate earlier messages) and paraphrased for cleanup, but preserving every detail rather than condensing.
- **Merged UI** — captured emails and captured meetings share one "Communications" surface, both at the project level and in the KPI-dashboard triage card, rather than two parallel views.

Per sub-project 1's non-goals, this spec supersedes that deferral and covers email capture.

## Goals

- An email involving a project's external stakeholders (a project's `externalRecipients`, or a linked client's active CRM contacts — the same set `stakeholderIndex` already unifies) is automatically captured and attached to the right project, no manual step.
- At least one participant must be external — purely internal team-to-team threads are never captured, mirroring Pulse's internal-domain guard and the incident that motivated it.
- Stored content is the new message body only (quoted history stripped), sanitized/paraphrased without losing detail — not a summary, not the raw un-stripped body, no attachments.
- If an email doesn't clearly belong to one project (no match, or more than one), it's queued for a human to assign or discard — never guessed.
- Captured emails and captured meetings appear together in one chronological "Communications" view, per-project and in the dashboard triage card.
- Matching reuses `stakeholderIndex` unchanged — no second matching index to keep in sync.

## Non-goals

- Attachments.
- Full email thread/conversation grouping UI (a `gmailThreadId` field is stored for future use, but no threaded view is built now).
- Domain-wide/service-account Gmail access — this is strictly per-user OAuth consent, matching Pulse and matching the user's explicit choice.
- Historical backfill — syncing a newly connected account starts from its connection time forward, not from years of prior mail. (Flagged as an assumption; revisit if wrong.)
- Outbound send tracking for BOM-Tracker's own transactional email (PR/PO/support-followup via SendGrid/Resend) — this spec is about Gmail inbox capture, not logging BOM-Tracker's own outgoing mail.
- A shared npm package/submodule with Pulse — logic is ported and adapted, not runtime-shared (see Design §5).

## Design

### 1. Ingestion: per-user Gmail OAuth + scheduled sync

**Connection.** A "Connect Gmail" action in Settings starts a standard Google OAuth consent flow requesting Gmail read scope. The OAuth consent screen must be **Internal** (Workspace-restricted to `@qualitastech.com`/`@datasensor.in`) — confirmed available, so no Google app-verification review is needed. A callable (`connectGmailAccount`) exchanges the returned auth code for a refresh token and writes it server-side.

`gmailConnections/{uid}`:
```ts
interface GmailConnection {
  email: string;
  refreshToken: string;       // server-only; see §6 security
  status: 'connected' | 'needs_reconnect';
  lastHistoryId?: string;     // Gmail API sync cursor
  connectedAt: Timestamp;
  lastSyncedAt?: Timestamp;
}
```
Firestore rules deny all client reads/writes on this collection — only Cloud Functions (Admin SDK) ever touch it. No refresh token is ever sent to a client.

**Sync.** A new scheduled function `syncGmailAccounts` (`onSchedule`, same family as `sendWeeklyBOMDigest`) runs every ~10 minutes. For each `gmailConnections` doc with `status: 'connected'`: call the Gmail API for messages newer than `lastHistoryId` (or, on first sync, from `connectedAt` forward — no backfill), process each new message per §2–4, then advance `lastHistoryId`.

On a Gmail API auth failure (revoked/expired token) for an account: set `status: 'needs_reconnect'` and skip that account on future cycles (no repeated failing calls) until the user reconnects via Settings, where a "Reconnect Gmail" banner is shown for that status.

### 2. Capture-scope guard (ported from Pulse)

Before matching, a message is only a capture candidate if **at least one participant (from/to/cc) is external** — not on an internal domain, and not on a personal-mail domain acting as a stand-in for a real contact. Ported from Pulse's `services/emailStakeholders.js`, adapted field names:

```js
// functions/emailIngestion.js
const INTERNAL_MAIL_DOMAINS = new Set(['qualitastech.com', 'datasensor.in']);
const PERSONAL_MAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
  'live.com', 'aol.com', 'rediffmail.com', 'protonmail.com',
]);

function getEmailDomain(email) { /* ported unchanged */ }
function parseAddressList(headerValue) { /* ported unchanged — handles
  quoted display names, angle brackets, comma/semicolon separators */ }
```
A purely internal-domain thread (both/all participants on `INTERNAL_MAIL_DOMAINS`) is skipped entirely before matching — never written anywhere, not even to `unassignedEmails`. This is the direct mitigation for the incident class Pulse hit: a generic internal mailbox can never itself satisfy the "external participant" requirement.

### 3. Matching: reuses `stakeholderIndex`

No new index. Only the message's **external** participants (the ones that satisfied the §2 capture guard) are looked up in the existing `stakeholderIndex/{email}` collection (same one Fathom meeting matching reads), unioning matched project ids via the existing `collectMatchedProjectIds` helper (`functions/fathomMeeting.js`) — no changes needed there.

This deliberately differs from meeting matching, which looks up *every* attendee including internal ones. For a meeting, "who attended" is a strong, self-contained signal. For email, CC habits are messier — a manager CC'd out of habit is often a member of several unrelated projects, and looking up their email too would risk a spurious multi-project match (pushing an otherwise-clear email into `unassignedEmails` for no good reason) purely because of who happened to be CC'd, not who the email is actually about. Keying only on the external correspondent(s) avoids that noise.

- **Exactly one project:** the email is attached there.
- **Zero or multiple projects:** goes to `unassignedEmails/{messageId}` for manual triage — never guessed, same rule as meetings.

### 4. Sanitization: strip quoted history, paraphrase without condensing

For each captured message, an LLM call (Gemini, reusing the pattern already established in `functions/supportEngineerFollowUp.js`) receives the raw message body and returns the new content only — quoted reply chains, signature blocks, and disclaimers removed, the remaining text paraphrased for cleanup but preserving every detail (explicitly instructed not to summarize/condense).

**Fallback on failure:** if the LLM call fails or returns invalid output, fall back to a regex-based quote-stripper (cut at `On ... wrote:` / `-----Original Message-----` / a line of repeated `>` quote markers) applied to the raw body, and set `sanitizeFailed: true` on the stored doc. The message is never dropped for a sanitization failure.

### 5. Data model

`projects/{projectId}/emails/{messageId}` (doc id = Gmail message id):
```ts
interface ProjectEmail {
  gmailMessageId: string;
  gmailThreadId: string;        // stored for future threading UI, unused now
  subject: string;
  from: { email: string; name?: string };
  to: { email: string; name?: string }[];
  cc: { email: string; name?: string }[];
  sentAt: Timestamp;
  direction: 'inbound' | 'outbound';   // derived from whether `from` is an internal domain
  body: string;                 // sanitized new-content-only body, no attachments
  sanitizeFailed: boolean;
  matchedStakeholderEmails: string[];  // audit trail, same purpose as meetings
  createdAt: Timestamp;
}
```

`unassignedEmails/{messageId}` — same shape plus `candidateProjectIds: string[]`.

`gmailIngestedMessages/{messageId}` — lightweight dedup marker, same purpose as `fathomIngestedMeetings`: the sync loop checks this before matching so an overlapping poll window (re-fetching messages near the previous `lastHistoryId` boundary) never double-processes a message regardless of which collection it ultimately lands in.

### 6. Security

- `gmailConnections` refresh tokens: server-only, Firestore rules deny all client access, only touched by `connectGmailAccount` (write) and `syncGmailAccounts` (read) — both Cloud Functions.
- OAuth consent screen: Internal/Workspace-restricted (confirmed), avoiding Google's app-verification review for the Gmail read scope.
- No new client-facing HTTPS endpoint (unlike the Fathom webhook) — ingestion is entirely pull/scheduled, so there's no signature-verification surface to build here.

### 7. Manual triage: merged with meetings

`assignUnassignedEmail`/`discardUnassignedEmail` callables, identical shape and admin gate to `assignUnassignedMeeting`/`discardUnassignedMeeting` (`functions/index.js`).

The KPI dashboard's "Needs Attention" panel gets one merged **"Communications Needing Assignment"** list (replacing the meetings-only card from sub-project 1) drawing from both `unassignedMeetings` and `unassignedEmails`, each row showing a type icon (video vs. mail), the existing project-picker-or-discard UX unchanged.

### 8. UI: merged "Communications" tab

`ProjectMeetingsTab.tsx` (sub-project 1) is replaced by `ProjectCommunicationsTab.tsx`, subscribing to both `projects/{id}/meetings` and `projects/{id}/emails`, merging and sorting by timestamp (`startedAt` for meetings, `sentAt` for emails) into one newest-first list. Each row is type-differentiated (meeting card: title/attendees/summary/"View recording" link, as today; email card: subject/from/to/sanitized body). Same non-partner access gating already in place for the Meetings tab carries over unchanged.

### 9. Code reuse with Pulse

Ported, not shared at runtime — matching the strategy `functions/fathomMeeting.js` already used for Svix verification. `functions/emailIngestion.js` adapts Pulse's `emailStakeholders.js` domain-guard constants and address-parsing helpers to BOM-Tracker's field names. No shared package/submodule: the two projects have incompatible storage layers (Pulse: SQLite/Express; BOM-Tracker: Firestore/Cloud Functions v2), so only the stack-agnostic parsing/classification logic is portable at all — the ingestion, storage, and scheduling code is necessarily written fresh for each.

## Decisions (resolved during brainstorming)

1. **Ingestion mechanism** — per-user OAuth Gmail polling (matches Pulse), not a shared mailbox or push webhook.
2. **Storage content** — full sanitized current-message body (quoted history stripped, paraphrased without condensing), not a Pulse-style AI summary, no attachments.
3. **Capture scope** — at least one external participant required; purely internal threads are never captured.
4. **UI placement** — merged "Communications" tab and merged dashboard triage card, not parallel meetings/emails surfaces.
5. **Code reuse with Pulse** — port proven logic (domain guards, address parsing), no shared runtime package.
6. **OAuth consent screen** — confirmed Internal/Workspace-restricted, no Google verification review needed.
