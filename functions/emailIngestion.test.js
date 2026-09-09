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
