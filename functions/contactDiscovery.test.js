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
