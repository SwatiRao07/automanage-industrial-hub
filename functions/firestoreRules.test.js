const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

test('server-only communication collections cannot be opened by an authenticated catch-all', () => {
  assert.doesNotMatch(
    rules,
    /match \/\{document=\*\*\}[\s\S]*?allow read, write: if request\.auth != null;/
  );

  for (const collection of [
    'gmailConnections',
    'stakeholderIndex',
    'projectStakeholderCache',
    'gmailIngestedMessages',
    'gmailIngestedMessageIds',
    'fathomIngestedMeetings',
  ]) {
    assert.match(
      rules,
      new RegExp(`match /${collection}/\\{document=\\*\\*\\} \\{[\\s\\S]*?allow read, write: if false;`),
      `${collection} must remain server-only`
    );
  }
});

test('gmailContactDirectory and gmailContactDiscoveryJobs are readable only by their own uid, never client-writable', () => {
  for (const collection of ['gmailContactDirectory', 'gmailContactDiscoveryJobs']) {
    assert.match(
      rules,
      new RegExp(`match /${collection}/\\{uid\\} \\{[\\s\\S]{0,300}?allow read: if request\\.auth != null[\\s\\S]{0,100}?request\\.auth\\.uid == uid[\\s\\S]{0,100}?allow write: if false;`),
      `${collection} must be per-uid read-only`
    );
  }
});

test('emailBackfillJobs is readable by project members and admins, never client-writable', () => {
  assert.match(
    rules,
    /match \/emailBackfillJobs\/\{projectId\} \{[\s\S]{0,600}?allow read: if request\.auth != null[\s\S]{0,200}?request\.auth\.token\.role == 'admin'[\s\S]{0,300}?memberIds[\s\S]{0,300}?allow write: if false;/
  );
});
