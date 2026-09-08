# Fathom Meeting Capture (Communications Tracking, Sub-project 1 of 2)

## Status
Draft — pending user review

## Context

The user asked to replicate, for BOM-Tracker projects, a capability that exists on the sales side in Pulse (`Pulse-UI---Goal-Tracking-Bot`): auto-logging Fathom meeting recordings against the right record and tracking all stakeholder communication. The request had two parts — meetings and email — and named "stakeholders" as a prerequisite for both, since matching an incoming meeting/email to a project depends on knowing who the project's external contacts are.

Investigation of both codebases during brainstorming settled the following, superseding the user's initial description:

- **Pulse's Fathom integration is not an n8n flow.** It's a direct Svix-signed webhook (`services/fathomWebhook.js`) to `POST /api/meetings/ingest`, matched to a deal via `services/meetingMapper.js` (attendee email → company domain → open deal, with an LLM fallback). It is built but **not yet live** (pending `FATHOM_WEBHOOK_SECRET` + pointing Fathom's destination URL at it).
- **Extending Pulse instead of building natively was considered and rejected.** Pulse's matching is deal-based (`OPEN_DEAL_STAGES`) and most of the BOM-Tracker projects this is meant to cover are "projects in planning" that don't have a working `pulseProjectId` link back to a Pulse deal. A proxy architecture would leave exactly the projects that need this uncovered. This sub-project is therefore native to BOM-Tracker (Firebase Functions + Firestore), independent of Pulse.
- **Stakeholders already exist and need no new sub-project.** `project.externalRecipients: {name, email, notificationsEnabled}[]` (`src/types/project.ts`), manually managed today via the Members tab (`src/components/Project/ProjectMembersTab.tsx`) as "email-only recipients" for BOM digest emails. It is structurally exactly the per-project external-contact list this feature needs to match against. Internal project members (`project.members`, login-tied) are the other half of the audience. No new stakeholder data model or UI is needed — this sub-project reuses both as-is.

This spec covers **meeting capture only**. Email capture (Gmail) is sub-project 2, deliberately out of scope here — it requires net-new OAuth/mailbox infrastructure BOM-Tracker doesn't have today, and gets its own brainstorm once this ships.

## Goals

- A Fathom meeting recording involving a project's stakeholders (external recipients or internal members) is automatically captured and attached to that project, with no manual step.
- If a meeting doesn't clearly belong to one project (no match, or more than one), it's queued for a human to assign rather than silently dropped or silently misattached.
- Project users can see a project's meeting history (title, time, attendees, summary, link to the recording) from within BOM-Tracker.
- Matching stays cheap: adding a meeting must not require scanning every project's stakeholder list on every webhook call.

## Non-goals

- Gmail/email capture (sub-project 2, separate spec).
- Storing or displaying the full meeting transcript — only Fathom's summary, action items, and a link back to the recording (matches Pulse's shipped decision, and avoids duplicating/storing sensitive verbatim content).
- Any change to how stakeholders are added or edited — `externalRecipients`/`members` CRUD stays exactly as it is in `ProjectMembersTab.tsx` today.
- Retroactively importing historical Fathom meetings — capture starts from when the webhook goes live.
- A generic "Communications" cross-source timeline UI — this spec adds a Meetings view; unifying it with email view is a sub-project-2-or-later concern once email capture exists.

## Design

### 1. Ingestion: `fathomMeetingWebhook`

A new Cloud Function (`functions/index.js`, `onRequest`, v2 — same family as `parseVendorQuotePDF`/`runComplianceCheck`) receiving Fathom's webhook directly, no n8n or other middleman. Verifies the Svix signature the same way Pulse's `services/fathomWebhook.js` does (same header names, same HMAC scheme — Fathom's webhook contract is identical regardless of receiver). Rejects unsigned/invalid requests with 401 before touching Firestore.

Payload gives: recording id (for dedup), title, share URL, start/end time, host email, attendee emails, AI summary, action items. Function dedups on `fathomRecordingId` (a meeting already ingested is a no-op 200, matching Pulse's idempotency behavior — Fathom may retry deliveries).

### 2. Matching: attendee emails → project

Firestore can't efficiently ask "which project has stakeholder X" across all projects without either an index or a full scan. Chosen approach: a denormalized lookup collection.

`stakeholderIndex/{lowercasedEmail}` → `{ projectIds: string[] }`

Kept in sync at the point stakeholders already change today: `addExternalRecipient` / `removeExternalRecipient` (and the equivalent add/remove for `members`) in `src/utils/projectFirestore.ts` gain a paired write to this index (add the project id to the doc for that email; remove it, deleting the doc if the array empties). This is the only change to existing stakeholder code in this spec — no UI change, no change to what a stakeholder *is*.

On webhook receipt: look up every attendee email in `stakeholderIndex` (parallel `get()`s, cheap even for a large attendee list). Union the resulting project ids:
- **Exactly one project:** the meeting is attached there directly.
- **Zero or multiple projects:** the meeting goes to `unassignedMeetings/{id}` for manual triage (mirrors Pulse's "Pipeline inbox" pattern) — never guessed automatically. No LLM fallback in this pass (Pulse needs one because it's matching against open-ended deal names; BOM-Tracker's stakeholder list is an exact, curated email set, so an index hit is either right or absent).

### 3. Data model

`projects/{projectId}/meetings/{meetingId}`:
```ts
interface ProjectMeeting {
  fathomRecordingId: string;   // dedup key
  title: string;
  shareUrl: string;            // link to recording on Fathom, not stored transcript
  startedAt: Timestamp;
  endedAt: Timestamp;
  hostEmail: string;
  attendees: { email: string; name?: string }[];
  summary: string;             // Fathom's AI summary
  actionItems: string[];
  matchedStakeholderEmails: string[]; // which attendees triggered the match, for auditability
  createdAt: Timestamp;
}
```

`unassignedMeetings/{meetingId}` — same shape plus `candidateProjectIds: string[]` (empty for zero-match, 2+ for ambiguous), for the triage UI to resolve into a real assignment (which then writes the doc into the right project's `meetings` subcollection and deletes it from here).

### 4. UI

- New "Meetings" sub-tab on the project BOM page (alongside the existing Documents tab pattern), listing `projects/{id}/meetings` newest-first: title, date, attendees, summary snippet, "View recording" link out to Fathom.
- A small "Unassigned Meetings" inbox, visible to admins, listing `unassignedMeetings` with a project picker to resolve each one (or a "discard" action for meetings that genuinely aren't project-related, e.g. internal-only calls with no external stakeholder). Placement: a card on the KPI dashboard (`Index.tsx`) next to the existing "Needs Attention" panel, or a Settings sub-tab — open question, see below.

### 5. Setup (operational, not code)

Generate a Fathom API key/webhook, point its destination URL at the deployed `fathomMeetingWebhook`, store the signing secret as a Firebase Function secret (`firebase functions:secrets:set`). This is independent of and does not touch Pulse's own (still-inactive) Fathom webhook — the same Fathom account can have multiple webhook destinations.

## Open questions

1. **Unassigned-meetings inbox placement** — KPI dashboard card vs. a dedicated Settings/admin page. Leaning dashboard card since that's already the "needs action" surface (`Index.tsx`'s existing pending-approvals panel), but want confirmation.
2. **Who can see a project's Meetings tab** — same access control as the rest of the project (existing member/role gate), or restricted further (e.g. admins only, since meeting summaries may contain sensitive discussion)? Assumed same as project access unless told otherwise.
