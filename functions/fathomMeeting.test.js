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
