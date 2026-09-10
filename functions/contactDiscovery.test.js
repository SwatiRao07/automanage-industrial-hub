// functions/contactDiscovery.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractExternalParticipantsFromHeaders,
  mergeParticipantsIntoAccumulator,
  buildContactDirectory,
  formatGmailDate,
  buildBackfillSearchQuery,
  findUnresolvedContacts,
  buildBackfillJobFields,
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

test('findUnresolvedContacts returns emails whose stakeholderIndex projectIds do not include this project', () => {
  const emailToProjectIds = {
    'jane@clientco.com': ['proj-1'],
    'bob@clientco.com': ['proj-1', 'proj-2'],
    'sam@clientco.com': ['proj-2'],
  };
  const result = findUnresolvedContacts(
    ['jane@clientco.com', 'bob@clientco.com', 'sam@clientco.com'],
    'proj-1',
    emailToProjectIds
  );
  assert.deepEqual(result, ['sam@clientco.com']);
});

test('findUnresolvedContacts treats a missing stakeholderIndex entry as unresolved', () => {
  const result = findUnresolvedContacts(['nobody@clientco.com'], 'proj-1', {});
  assert.deepEqual(result, ['nobody@clientco.com']);
});

test('findUnresolvedContacts is case-insensitive on the lookup key and returns an empty array once every contact resolves', () => {
  const emailToProjectIds = { 'jane@clientco.com': ['proj-1'] };
  const result = findUnresolvedContacts(['Jane@ClientCo.com'], 'proj-1', emailToProjectIds);
  assert.deepEqual(result, []);
});

test('buildBackfillJobFields creates a fresh job for a project with no existing job', () => {
  const sinceDate = new Date('2025-09-10T00:00:00.000Z');
  const result = buildBackfillJobFields({
    existingJob: null,
    pendingContactEmails: ['a@x.com', 'b@y.com'],
    requestedByUid: 'uid-1',
    defaultSinceDate: sinceDate,
  });
  assert.deepEqual(result, {
    status: 'pending',
    contacts: ['a@x.com', 'b@y.com'],
    completedContacts: [],
    sinceDate,
    processedCount: 0,
    matchedCount: 0,
    requestedByUid: 'uid-1',
  });
});

test('buildBackfillJobFields merges new contacts into an existing job without duplicating already-queued ones', () => {
  const existingJob = {
    contacts: ['a@x.com'],
    completedContacts: ['a@x.com'],
    sinceDate: new Date('2025-01-01T00:00:00.000Z'),
    processedCount: 10,
    matchedCount: 3,
    requestedByUid: 'uid-original',
  };
  const result = buildBackfillJobFields({
    existingJob,
    pendingContactEmails: ['a@x.com', 'c@z.com'],
    requestedByUid: 'uid-1',
    defaultSinceDate: new Date('2025-09-10T00:00:00.000Z'),
  });
  assert.deepEqual(result, {
    status: 'pending',
    contacts: ['a@x.com', 'c@z.com'],
    completedContacts: ['a@x.com'],
    sinceDate: existingJob.sinceDate,
    processedCount: 10,
    matchedCount: 3,
    requestedByUid: 'uid-original',
  });
});

test('buildBackfillJobFields preserves the original requestedByUid even when a different admin extends the job', () => {
  const existingJob = { contacts: ['a@x.com'], requestedByUid: 'uid-original' };
  const result = buildBackfillJobFields({
    existingJob,
    pendingContactEmails: ['c@z.com'],
    requestedByUid: 'uid-different-admin',
    defaultSinceDate: new Date('2025-09-10T00:00:00.000Z'),
  });
  assert.equal(result.requestedByUid, 'uid-original');
});
