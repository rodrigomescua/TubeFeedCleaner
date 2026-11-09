const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

test('login pauses the worker, verifies the session, and rejects other origins', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-cleaner-test-'));
  const moduleDir = path.join(dir, 'node_modules/playwright');
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.writeFileSync(path.join(moduleDir, 'index.js'), `
    const { EventEmitter } = require('events');
    exports.chromium = { async launchPersistentContext() {
      const browser = new EventEmitter();
      const page = { async goto() {}, async reload() {}, async waitForFunction() {}, async waitForSelector() {}, async evaluate(fn) {
        return fn.toString().includes('LOGGED_IN') ? true : { videos: [], hidden: [] };
      } };
      browser.pages = () => [page]; browser.close = async () => browser.emit('close'); return browser;
    } };
  `);
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['app/server.js'], { env: { ...process.env, NODE_OPTIONS: `--require=${path.join(__dirname, 'mock-playwright.js')}`, PLAYWRIGHT_MOCK: path.join(moduleDir, 'index.js'), DATA_FILE: path.join(dir, 'state.json'), CHROME_PROFILE: path.join(dir, 'profile'), PORT: String(port) }, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try { await fetch(base + '/api/state'); ready = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(ready, 'server started');
    const post = (url, origin = base) => fetch(base + url, { method: 'POST', headers: { origin } });
    assert.equal((await post('/api/login/start', 'http://other.example')).status, 403);
    assert.equal((await post('/api/login/start')).status, 200);
    assert.equal((await (await fetch(base + '/api/state')).json()).connection, 'connecting');
    assert.equal((await post('/api/run')).status, 409);
    assert.equal((await post('/api/login/finish')).status, 200);
    assert.equal((await (await fetch(base + '/api/state')).json()).connection, 'connected');
    assert.equal((await post('/api/login/start')).status, 200);
    assert.equal((await post('/api/login/cancel')).status, 200);
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
