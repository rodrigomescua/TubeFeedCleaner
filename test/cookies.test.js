const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCookies } = require('../app/cookies');

test('imports only YouTube cookies including HttpOnly and session cookies', () => {
  const result = parseCookies('# Netscape HTTP Cookie File\n#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tvalue\n.example.com\tTRUE\t/\tTRUE\t0\tother\tsecret\n');
  assert.deepEqual(result, [{ domain: '.youtube.com', path: '/', name: 'SID', value: 'value', secure: true, httpOnly: true, expires: -1 }]);
  assert.throws(() => parseCookies('invalid'));
  assert.throws(() => parseCookies('# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t0\tother\tsecret\n'));
  assert.throws(() => parseCookies('# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tname'));
});
