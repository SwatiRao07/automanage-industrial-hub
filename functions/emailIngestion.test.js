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

const { exchangeAuthCodeForTokens, refreshAccessToken } = require('./emailIngestion');

test('exchangeAuthCodeForTokens exchanges a code and fetches the connected profile', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return {
        ok: true,
        json: async () => ({ access_token: 'access-1', refresh_token: 'refresh-1' }),
      };
    }
    if (String(url).includes('gmail/v1/users/me/profile')) {
      return { ok: true, json: async () => ({ emailAddress: 'me@qualitastech.com', historyId: '1000' }) };
    }
    throw new Error(`unexpected url: ${url}`);
  };

  const result = await exchangeAuthCodeForTokens({
    code: 'auth-code',
    redirectUri: 'https://visionbomtracker.web.app/settings',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    fetchImpl,
  });

  assert.deepEqual(result, {
    refreshToken: 'refresh-1',
    accessToken: 'access-1',
    email: 'me@qualitastech.com',
    historyId: '1000',
  });
  assert.equal(calls[0].options.method, 'POST');
  assert.match(calls[0].options.body, /code=auth-code/);
  assert.match(calls[0].options.body, /grant_type=authorization_code/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer access-1');
});

test('exchangeAuthCodeForTokens throws when the token endpoint rejects the code', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400 });
  await assert.rejects(
    () => exchangeAuthCodeForTokens({
      code: 'bad-code', redirectUri: 'https://x', clientId: 'c', clientSecret: 's', fetchImpl,
    }),
    /Gmail token exchange failed: 400/
  );
});

test('exchangeAuthCodeForTokens throws when no refresh token is returned', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ access_token: 'a' }) });
  await assert.rejects(
    () => exchangeAuthCodeForTokens({
      code: 'c', redirectUri: 'https://x', clientId: 'c', clientSecret: 's', fetchImpl,
    }),
    /did not return a refresh token/
  );
});

test('refreshAccessToken returns a fresh access token', async () => {
  const fetchImpl = async (url, options) => {
    assert.match(options.body, /grant_type=refresh_token/);
    assert.match(options.body, /refresh_token=refresh-1/);
    return { ok: true, json: async () => ({ access_token: 'access-2' }) };
  };
  const result = await refreshAccessToken({
    refreshToken: 'refresh-1', clientId: 'c', clientSecret: 's', fetchImpl,
  });
  assert.deepEqual(result, { accessToken: 'access-2' });
});

test('refreshAccessToken throws with a status code when the refresh token is revoked', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400 });
  await assert.rejects(
    () => refreshAccessToken({ refreshToken: 'bad', clientId: 'c', clientSecret: 's', fetchImpl }),
    (error) => {
      assert.match(error.message, /Gmail token refresh failed: 400/);
      assert.equal(error.status, 400);
      return true;
    }
  );
});

const { listNewGmailMessageIds, getGmailMessage } = require('./emailIngestion');

test('listNewGmailMessageIds collects messageAdded ids and the latest historyId', async () => {
  const fetchImpl = async (url) => {
    assert.match(String(url), /startHistoryId=1000/);
    assert.match(String(url), /historyTypes=messageAdded/);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        history: [
          { messagesAdded: [{ message: { id: 'm1' } }] },
          { messagesAdded: [{ message: { id: 'm2' } }, { message: { id: 'm1' } }] },
        ],
        historyId: '1050',
      }),
    };
  };

  const result = await listNewGmailMessageIds({ accessToken: 'token', startHistoryId: '1000', fetchImpl });
  assert.deepEqual(result, { messageIds: ['m1', 'm2'], newHistoryId: '1050', historyExpired: false });
});

test('listNewGmailMessageIds follows pageToken pagination', async () => {
  let call = 0;
  const fetchImpl = async (url) => {
    call += 1;
    if (call === 1) {
      assert.doesNotMatch(String(url), /pageToken/);
      return { ok: true, status: 200, json: async () => ({ history: [{ messagesAdded: [{ message: { id: 'm1' } }] }], nextPageToken: 'p2', historyId: '1010' }) };
    }
    assert.match(String(url), /pageToken=p2/);
    return { ok: true, status: 200, json: async () => ({ history: [{ messagesAdded: [{ message: { id: 'm2' } }] }], historyId: '1020' }) };
  };

  const result = await listNewGmailMessageIds({ accessToken: 'token', startHistoryId: '1000', fetchImpl });
  assert.deepEqual(result, { messageIds: ['m1', 'm2'], newHistoryId: '1020', historyExpired: false });
});

test('listNewGmailMessageIds reports historyExpired on a 404', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404 });
  const result = await listNewGmailMessageIds({ accessToken: 'token', startHistoryId: '1000', fetchImpl });
  assert.deepEqual(result, { messageIds: [], newHistoryId: '1000', historyExpired: true });
});

test('listNewGmailMessageIds throws on a non-404 error status', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500 });
  await assert.rejects(
    () => listNewGmailMessageIds({ accessToken: 'token', startHistoryId: '1000', fetchImpl }),
    /Gmail history.list failed: 500/
  );
});

test('listNewGmailMessageIds returns no ids when there is no new history', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ historyId: '1000' }) });
  const result = await listNewGmailMessageIds({ accessToken: 'token', startHistoryId: '1000', fetchImpl });
  assert.deepEqual(result, { messageIds: [], newHistoryId: '1000', historyExpired: false });
});

test('getGmailMessage fetches a full-format message resource', async () => {
  const fetchImpl = async (url, options) => {
    assert.match(String(url), /messages\/msg_1\?format=full/);
    assert.equal(options.headers.Authorization, 'Bearer token');
    return { ok: true, json: async () => ({ id: 'msg_1' }) };
  };
  const result = await getGmailMessage({ accessToken: 'token', messageId: 'msg_1', fetchImpl });
  assert.deepEqual(result, { id: 'msg_1' });
});

test('getGmailMessage throws on a failed fetch', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404 });
  await assert.rejects(
    () => getGmailMessage({ accessToken: 'token', messageId: 'msg_1', fetchImpl }),
    /Gmail messages.get failed: 404/
  );
});

const { sanitizeEmailBody } = require('./emailIngestion');

test('sanitizeEmailBody returns the Gemini-cleaned body on success', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    return {
      ok: true,
      json: async () => ({
        steps: [{
          type: 'model_output',
          content: [{ type: 'text', text: JSON.stringify({ body: 'Cleaned new content.' }) }],
        }],
      }),
    };
  };

  const result = await sanitizeEmailBody({ apiKey: 'test-key', rawBody: 'Raw content.\n\nOn ... wrote:\n> old', fetchImpl });
  assert.deepEqual(result, { body: 'Cleaned new content.', sanitizeFailed: false });
});

test('sanitizeEmailBody falls back to the regex stripper when no API key is configured', async () => {
  const result = await sanitizeEmailBody({
    apiKey: '', rawBody: 'New content.\n\nOn Mon wrote:\n> old', fetchImpl: async () => { throw new Error('should not be called'); },
  });
  assert.deepEqual(result, { body: 'New content.', sanitizeFailed: true });
});

test('sanitizeEmailBody falls back to the regex stripper when Gemini returns a non-OK response', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500 });
  const result = await sanitizeEmailBody({ apiKey: 'test-key', rawBody: 'New content.\n> quoted', fetchImpl });
  assert.deepEqual(result, { body: 'New content.', sanitizeFailed: true });
});

test('sanitizeEmailBody falls back to the regex stripper when Gemini returns an empty body', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ body: '' }) }] }] }),
  });
  const result = await sanitizeEmailBody({ apiKey: 'test-key', rawBody: 'New content.\n> quoted', fetchImpl });
  assert.deepEqual(result, { body: 'New content.', sanitizeFailed: true });
});

test('sanitizeEmailBody falls back to the regex stripper when the fetch call throws', async () => {
  const fetchImpl = async () => { throw new Error('network down'); };
  const result = await sanitizeEmailBody({ apiKey: 'test-key', rawBody: 'New content.\n> quoted', fetchImpl });
  assert.deepEqual(result, { body: 'New content.', sanitizeFailed: true });
});

test('sanitizeEmailBody treats blank raw input as already-empty without calling Gemini', async () => {
  const result = await sanitizeEmailBody({ apiKey: 'test-key', rawBody: '   ', fetchImpl: async () => { throw new Error('should not be called'); } });
  assert.deepEqual(result, { body: '', sanitizeFailed: true });
});
