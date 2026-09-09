const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getEmailDomain,
  parseAddressList,
  hasExternalParticipant,
  filterExternalParticipants,
  classifyDirection,
  INTERNAL_MAIL_DOMAINS,
  PERSONAL_MAIL_DOMAINS,
} = require('./emailIngestion');

test('getEmailDomain lowercases and extracts the domain', () => {
  assert.equal(getEmailDomain('Jane@ClientCo.com'), 'clientco.com');
  assert.equal(getEmailDomain(''), null);
  assert.equal(getEmailDomain(null), null);
});

test('parseAddressList handles quoted display names and angle brackets', () => {
  const result = parseAddressList('"Jane Client" <jane@clientco.com>, host@qualitastech.com');
  assert.deepEqual(result, [
    { name: 'Jane Client', email: 'jane@clientco.com' },
    { name: '', email: 'host@qualitastech.com' },
  ]);
});

test('parseAddressList handles semicolon separators and ignores empty entries', () => {
  const result = parseAddressList('a@x.com; ; "B C" <b@x.com>');
  assert.deepEqual(result, [
    { name: '', email: 'a@x.com' },
    { name: 'B C', email: 'b@x.com' },
  ]);
});

test('parseAddressList returns an empty array for blank input', () => {
  assert.deepEqual(parseAddressList(''), []);
  assert.deepEqual(parseAddressList(undefined), []);
});

test('hasExternalParticipant is true when at least one participant is outside INTERNAL_MAIL_DOMAINS', () => {
  const result = hasExternalParticipant([
    { email: 'host@qualitastech.com' },
    { email: 'jane@clientco.com' },
  ]);
  assert.equal(result, true);
});

test('hasExternalParticipant is false for a purely internal thread', () => {
  const result = hasExternalParticipant([
    { email: 'host@qualitastech.com' },
    { email: 'teammate@datasensor.in' },
  ]);
  assert.equal(result, false);
});

test('hasExternalParticipant ignores blank/missing emails', () => {
  assert.equal(hasExternalParticipant([{ email: '' }, { email: undefined }]), false);
  assert.equal(hasExternalParticipant([]), false);
});

test('filterExternalParticipants keeps only non-internal-domain participants', () => {
  const result = filterExternalParticipants([
    { email: 'host@qualitastech.com', name: 'Host' },
    { email: 'jane@clientco.com', name: 'Jane' },
    { email: '' },
  ]);
  assert.deepEqual(result, [{ email: 'jane@clientco.com', name: 'Jane' }]);
});

test('classifyDirection is outbound for an internal-domain sender, inbound otherwise', () => {
  assert.equal(classifyDirection('host@qualitastech.com'), 'outbound');
  assert.equal(classifyDirection('someone@datasensor.in'), 'outbound');
  assert.equal(classifyDirection('jane@clientco.com'), 'inbound');
});

test('INTERNAL_MAIL_DOMAINS and PERSONAL_MAIL_DOMAINS are exposed as Sets', () => {
  assert.ok(INTERNAL_MAIL_DOMAINS.has('qualitastech.com'));
  assert.ok(INTERNAL_MAIL_DOMAINS.has('datasensor.in'));
  assert.ok(PERSONAL_MAIL_DOMAINS.has('gmail.com'));
});

const { parseGmailMessage, stripQuotedHistory } = require('./emailIngestion');

const encode = (text) => Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

test('parseGmailMessage extracts headers and a text/plain body', () => {
  const resource = {
    id: 'msg_1',
    threadId: 'thread_1',
    internalDate: '1735732800000',
    payload: {
      headers: [
        { name: 'Subject', value: 'Quote request' },
        { name: 'From', value: '"Jane Client" <jane@clientco.com>' },
        { name: 'To', value: 'host@qualitastech.com' },
        { name: 'Cc', value: 'teammate@qualitastech.com' },
      ],
      mimeType: 'text/plain',
      body: { data: encode('Please send an updated quote.') },
    },
  };

  const result = parseGmailMessage(resource);

  assert.equal(result.gmailMessageId, 'msg_1');
  assert.equal(result.gmailThreadId, 'thread_1');
  assert.equal(result.subject, 'Quote request');
  assert.deepEqual(result.from, { name: 'Jane Client', email: 'jane@clientco.com' });
  assert.deepEqual(result.to, [{ name: '', email: 'host@qualitastech.com' }]);
  assert.deepEqual(result.cc, [{ name: '', email: 'teammate@qualitastech.com' }]);
  assert.equal(result.sentAt, new Date(1735732800000).toISOString());
  assert.equal(result.rawBody, 'Please send an updated quote.');
});

test('parseGmailMessage finds text/plain inside multipart parts', () => {
  const resource = {
    id: 'msg_2',
    threadId: 'thread_2',
    internalDate: '1735732800000',
    payload: {
      headers: [{ name: 'From', value: 'jane@clientco.com' }],
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/html', body: { data: encode('<p>Hi</p>') } },
        { mimeType: 'text/plain', body: { data: encode('Plain text body') } },
      ],
    },
  };

  const result = parseGmailMessage(resource);
  assert.equal(result.rawBody, 'Plain text body');
});

test('parseGmailMessage falls back to stripped text/html when no text/plain part exists', () => {
  const resource = {
    id: 'msg_3',
    threadId: 'thread_3',
    internalDate: '1735732800000',
    payload: {
      headers: [{ name: 'From', value: 'jane@clientco.com' }],
      mimeType: 'text/html',
      body: { data: encode('<p>Hello <b>there</b></p>') },
    },
  };

  const result = parseGmailMessage(resource);
  assert.equal(result.rawBody, 'Hello there');
});

test('parseGmailMessage handles a missing body gracefully', () => {
  const result = parseGmailMessage({ id: 'msg_4', threadId: 'thread_4', payload: { headers: [] } });
  assert.equal(result.rawBody, '');
  assert.deepEqual(result.to, []);
  assert.deepEqual(result.cc, []);
  assert.deepEqual(result.from, { name: '', email: '' });
});

test('stripQuotedHistory cuts at a Gmail-style "On ... wrote:" quote header', () => {
  const body = 'New content here.\n\nOn Mon, Jan 5, 2026 at 10:00 AM Jane <jane@clientco.com> wrote:\n> old quoted text';
  assert.equal(stripQuotedHistory(body), 'New content here.');
});

test('stripQuotedHistory cuts at an Outlook-style Original Message separator', () => {
  const body = 'New content.\n\n-----Original Message-----\nFrom: someone\nOld text';
  assert.equal(stripQuotedHistory(body), 'New content.');
});

test('stripQuotedHistory strips a trailing block of \'>\'-quoted lines', () => {
  const body = 'New content.\n> quoted line one\n> quoted line two';
  assert.equal(stripQuotedHistory(body), 'New content.');
});

test('stripQuotedHistory returns the trimmed body unchanged when there is no quoted history', () => {
  assert.equal(stripQuotedHistory('  Just new content.  '), 'Just new content.');
});

test('stripQuotedHistory handles empty input', () => {
  assert.equal(stripQuotedHistory(''), '');
  assert.equal(stripQuotedHistory(undefined), '');
});
