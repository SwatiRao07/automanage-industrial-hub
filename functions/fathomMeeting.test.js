const test = require('node:test');
const assert = require('node:assert/strict');

const {
  verifySvixSignature,
  computeSvixSignature,
  normalizeFathomPayload,
  collectMatchedProjectIds,
  extractStakeholderEmails,
  extractClientContactEmails,
  computeProjectStakeholderEmails,
  diffEmailSets,
  diffStakeholderEmails,
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

test('extractClientContactEmails collects active contacts, lowercased', () => {
  const emails = extractClientContactEmails({
    contacts: [
      { email: 'Ops@ClientCo.com', isActive: true },
      { email: 'inactive@clientco.com', isActive: false },
      { email: 'default-active@clientco.com' },
    ],
  });
  assert.deepEqual([...emails].sort(), ['default-active@clientco.com', 'ops@clientco.com']);
});

test('extractClientContactEmails handles a client with no contacts', () => {
  assert.deepEqual([...extractClientContactEmails({})], []);
  assert.deepEqual([...extractClientContactEmails(undefined)], []);
});

test('computeProjectStakeholderEmails unions project and client contact emails', () => {
  const projectData = { externalRecipients: [{ email: 'jane@clientco.com', name: 'Jane' }] };
  const clientData = { contacts: [{ email: 'bob@clientco.com', isActive: true }] };
  const emails = computeProjectStakeholderEmails(projectData, clientData);
  assert.deepEqual([...emails].sort(), ['bob@clientco.com', 'jane@clientco.com']);
});

test('computeProjectStakeholderEmails works with no client linked', () => {
  const projectData = { members: [{ email: 'alice@qt.com', userId: 'u1' }] };
  const emails = computeProjectStakeholderEmails(projectData, undefined);
  assert.deepEqual([...emails], ['alice@qt.com']);
});

test('diffEmailSets reports added and removed entries between two sets', () => {
  const before = new Set(['a@x.com', 'b@x.com']);
  const after = new Set(['b@x.com', 'c@x.com']);
  const { added, removed } = diffEmailSets(before, after);
  assert.deepEqual(added, ['c@x.com']);
  assert.deepEqual(removed, ['a@x.com']);
});
