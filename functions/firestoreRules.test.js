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
