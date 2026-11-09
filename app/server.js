const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { chromium } = require('playwright');
const { parseCookies } = require('./cookies');

const port = Number(process.env.PORT || 8080);
const configuredInterval = Number(process.env.INTERVAL_MINUTES);
const interval = Number.isInteger(configuredInterval) && configuredInterval >= 1 && configuredInterval <= 1440 ? configuredInterval : 30;
const dataFile = process.env.DATA_FILE || '/app/data/state.json';
const profile = process.env.CHROME_PROFILE || '/data/chrome';
const initial = { terms: [], enabled: true, autoHide: true, hideShorts: false, hideRelevant: false, history: [], feedVideos: [], repeatedPhrases: [], status: 'starting', lastRun: null, lastError: null, intervalMinutes: interval };
fs.mkdirSync(path.dirname(dataFile), { recursive: true });
let state = { ...initial, ...readState() };
if (!Number.isInteger(state.intervalMinutes) || state.intervalMinutes < 1 || state.intervalMinutes > 1440) state.intervalMinutes = interval;
let running = false;
let loopActive = false;
let timer;
let loginBrowser = null;
let loginBusy = false;
state.connection = 'unknown';
function readState() { try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch { return {}; } }
function save() { const tmp = `${dataFile}.tmp`; fs.writeFileSync(tmp, JSON.stringify(state, null, 2)); fs.renameSync(tmp, dataFile); }
function json(res, code, value) { const body = JSON.stringify(value); res.writeHead(code, {'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body)}); res.end(body); }
function body(req) { return new Promise((resolve, reject) => { let s=''; req.on('data', c => s += c); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } }); }); }
async function cookieBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 131072) throw new Error('Arquivo maior que 128 KB.'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}
function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim(); }
async function clean({ refreshOnly = false } = {}) {
  if ((!state.enabled && !refreshOnly) || running || loginBusy || loginBrowser) return false;
  running = true;
  state.status = 'running'; save();
  let browser;
  let completed = false;
  try {
    browser = await chromium.launchPersistentContext(profile, { headless: true });
    const page = browser.pages()[0] || await browser.newPage();
    await page.goto('https://www.youtube.com/feed/subscriptions', { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!await signedIn(page)) { state.connection = 'disconnected'; completed = true; return false; }
    state.connection = 'connected';
    await page.waitForSelector(':is(ytd-rich-item-renderer,ytd-video-renderer,ytd-grid-video-renderer,yt-lockup-view-model) a[href*="/watch"]', { timeout: 30000 });
    const scan = async ({ terms, autoHide }) => {
      const normalize = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
      const cards = [...document.querySelectorAll('ytd-rich-item-renderer,ytd-video-renderer,ytd-grid-video-renderer,yt-lockup-view-model')];
      const rows = cards.map(card => { const a = card.querySelector('a#video-title,a#video-title-link,a.yt-lockup-metadata-view-model__title,a.ytLockupMetadataViewModelTitle'); const title = (a?.getAttribute('title') || a?.textContent || '').trim(); const id = a ? new URL(a.href, location.origin).searchParams.get('v') : ''; return { card, title, id, url: a?.href || '' }; });
      const matches = rows.filter(x => x.title && terms.some(t => normalize(x.title).includes(normalize(t))));
      const out=[];
      for (const row of autoHide ? matches : []) {
        const button = row.card.querySelector('ytd-menu-renderer yt-icon-button,ytd-menu-renderer #button,button[aria-label*="More"],button[aria-label*="Ações"],button[aria-label*="ações"]');
        if (!button) continue;
        button.click(); await new Promise(r => setTimeout(r, 350));
        const item = [...document.querySelectorAll('[role="menuitem"],ytd-menu-service-item-renderer,tp-yt-paper-item')].find(x => normalize(x.innerText || x.textContent).includes('ocultar') || normalize(x.innerText || x.textContent).includes('hide'));
        if (item) { item.click(); out.push({ id: row.id, title: row.title }); await new Promise(r => setTimeout(r, 500)); }
      }
      return { videos: rows.map(({card,...v}) => v), hidden: out };
    };
    const result = await page.evaluate(scan, { terms: state.terms, autoHide: !refreshOnly && state.autoHide });
    const now = new Date().toISOString();
    if (result.hidden.length) { state.history = [...state.history, ...result.hidden.map(v => ({ ...v, hiddenAt: now }))].slice(-500); save(); }
    if (!refreshOnly) {
      let confirmed = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        if (!await signedIn(page)) { state.connection = 'disconnected'; completed = true; return false; }
        await page.waitForSelector(':is(ytd-rich-item-renderer,ytd-video-renderer,ytd-grid-video-renderer,yt-lockup-view-model) a[href*="/watch"]', { timeout: 30000 });
        const refreshed = await page.evaluate(scan, { terms: [], autoHide: false });
        result.videos = refreshed.videos;
        confirmed = !result.hidden.some(hidden => refreshed.videos.some(video => hidden.id ? video.id === hidden.id : !video.id && video.title === hidden.title));
        if (confirmed) break;
        await page.waitForTimeout(1000);
      }
      if (!confirmed) throw new Error('O YouTube ainda mostra vídeos que foram ocultados. Tente atualizar a lista novamente.');
    }
    state.feedVideos = [...new Map(result.videos.filter(v => v.title).map(v => [v.id || v.title, v])).values()].slice(0, 300);
    const counts = new Map();
    for (const { title } of state.feedVideos) { const words = (title.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z][a-z0-9]*/g) || []).filter(word => word.length > 3); for (let n=1;n<=3;n++) for (let i=0;i<=words.length-n;i++) { const phrase=words.slice(i,i+n).join(' '); counts.set(phrase,(counts.get(phrase)||0)+1); } }
    state.repeatedPhrases = [...counts].filter(([,count]) => count > 1).sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0])).slice(0, 50).map(([phrase,count])=>({phrase,count}));
    if (!refreshOnly) state.lastRun = now;
    state.lastError = null; completed = true;
    return true;
  } finally { try { if (browser) await browser.close(); } finally { running = false; } if (completed) { state.status = 'idle'; save(); } }
}
async function signedIn(page) {
  try {
    await page.waitForFunction(() => typeof window.ytcfg?.get('LOGGED_IN') === 'boolean', null, { timeout: 15000 });
    return await page.evaluate(() => window.ytcfg.get('LOGGED_IN') === true);
  } catch { return false; }
}
function schedule() { clearTimeout(timer); timer = setTimeout(loop, state.intervalMinutes * 60000); }
async function loop() { loopActive = true; try { await clean(); } catch (e) { state.status='error'; state.lastError=String(e.message || e); state.lastRun=new Date().toISOString(); save(); } finally { loopActive = false; schedule(); } }
const html = fs.readFileSync(path.join(__dirname, 'public/index.html'));
function sameOrigin(req) {
  try { return Boolean(req.headers.origin) && new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}
const server = http.createServer(async (req, res) => {
  try {
    if (['POST', 'PUT', 'DELETE'].includes(req.method) && !sameOrigin(req)) return json(res, 403, { error: 'Origem não autorizada.' });
    if (req.url.startsWith('/login-browser/') && req.method === 'GET') {
      if (!loginBrowser) { res.writeHead(404); return res.end(); }
      const proxy = http.request({ host: '127.0.0.1', port: 6080, path: req.url.slice('/login-browser'.length), method: 'GET' }, upstream => { res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res); });
      proxy.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      return proxy.end();
    }
    if (req.url === '/api/state' && req.method === 'GET') return json(res, 200, state);
    if (req.url === '/api/login/cookies' && req.method === 'POST') {
      if (running || loginBusy) return json(res, 409, { error: 'Aguarde a operação atual terminar.' });
      loginBusy = true;
      let temporary;
      try {
        const cookies = parseCookies(await cookieBody(req));
        temporary = await chromium.launch({ headless: true });
        const context = await temporary.newContext();
        await context.addCookies(cookies);
        const page = await context.newPage();
        await page.goto('https://www.youtube.com/feed/subscriptions', { waitUntil: 'domcontentloaded', timeout: 60000 });
        if (!await signedIn(page)) return json(res, 400, { error: 'Os cookies não confirmaram uma sessão ativa. Exporte novamente e tente outra vez.' });
        const validatedCookies = await context.cookies('https://www.youtube.com');
        await temporary.close(); temporary = null;
        if (loginBrowser) await loginBrowser.close();
        const persistent = await chromium.launchPersistentContext(profile, { headless: true });
        try { await persistent.addCookies(validatedCookies); } finally { await persistent.close(); }
        state.connection = 'connected'; state.status = 'idle'; state.lastError = null; save();
        loginBusy = false;
        clean().catch(e => { state.status = 'error'; state.lastError = String(e.message || e); save(); });
        return json(res, 200, { message: 'YouTube conectado.' });
      } finally { if (temporary) await temporary.close(); loginBusy = false; }
    }
    if (req.url === '/api/login/start' && req.method === 'POST') {
      if (running || loginBusy) return json(res, 409, { error: 'Aguarde a operação atual terminar.' });
      if (loginBrowser) return json(res, 200, { message: 'Login já aberto.' });
      loginBusy = true;
      try {
        loginBrowser = await chromium.launchPersistentContext(profile, { headless: false, viewport: null });
        loginBrowser.on('close', () => { loginBrowser = null; if (state.connection === 'connecting') { state.connection = 'unknown'; save(); } });
        await (loginBrowser.pages()[0] || await loginBrowser.newPage()).goto('https://www.youtube.com/feed/subscriptions', { waitUntil: 'domcontentloaded', timeout: 60000 });
        state.connection = 'connecting'; save();
        return json(res, 200, { message: 'Login aberto.' });
      } catch (e) { if (loginBrowser) await loginBrowser.close(); loginBrowser = null; throw e; }
      finally { loginBusy = false; }
    }
    if (req.url === '/api/login/finish' && req.method === 'POST') {
      if (!loginBrowser || loginBusy) return json(res, 409, { error: 'Abra o login primeiro.' });
      loginBusy = true;
      try {
        const page = loginBrowser.pages()[0] || await loginBrowser.newPage();
        await page.goto('https://www.youtube.com/feed/subscriptions', { waitUntil: 'domcontentloaded', timeout: 60000 });
        if (!await signedIn(page)) return json(res, 400, { error: 'Não foi possível confirmar o login. Conclua o acesso no YouTube e tente novamente.' });
        await loginBrowser.close(); loginBrowser = null;
        state.connection = 'connected'; state.status = 'idle'; state.lastError = null; save();
        loginBusy = false;
        clean().catch(e => { state.status = 'error'; state.lastError = String(e.message || e); save(); });
        return json(res, 200, { message: 'YouTube conectado.' });
      } finally { loginBusy = false; }
    }
    if (req.url === '/api/login/cancel' && req.method === 'POST') {
      if (loginBusy) return json(res, 409, { error: 'Aguarde a operação atual terminar.' });
      if (loginBrowser) await loginBrowser.close();
      loginBrowser = null; state.connection = 'unknown'; save();
      return json(res, 200, { message: 'Login fechado.' });
    }
    if (req.url === '/api/run' && req.method === 'POST') { if (running || loginBusy || loginBrowser) return json(res, 409, { error: 'Execução ou login em andamento' }); clean().catch(e => { state.status = 'error'; state.lastError = String(e.message || e); save(); }); return json(res, 202, { message: 'Execução iniciada' }); }
    if (req.url === '/api/refresh' && req.method === 'POST') { if (running || loginBusy || loginBrowser) return json(res, 409, { error: 'Execução ou login em andamento' }); clean({ refreshOnly: true }).catch(e => { state.status = 'error'; state.lastError = String(e.message || e); save(); }); return json(res, 202, { message: 'Atualização iniciada' }); }
    if (req.url === '/api/state' && req.method === 'PUT') { const patch = await body(req); if ('intervalMinutes' in patch && (!Number.isInteger(patch.intervalMinutes) || patch.intervalMinutes < 1 || patch.intervalMinutes > 1440)) return json(res, 400, { error: 'Informe um intervalo inteiro entre 1 e 1440 minutos.' }); if (Array.isArray(patch.terms)) state.terms = [...new Set(patch.terms.map(x => String(x).trim()).filter(Boolean))].slice(0, 500); for (const k of ['enabled','autoHide','hideShorts','hideRelevant']) if (typeof patch[k] === 'boolean') state[k] = patch[k]; if ('intervalMinutes' in patch) state.intervalMinutes = patch.intervalMinutes; save(); if ('intervalMinutes' in patch && !loopActive) schedule(); return json(res, 200, state); }
    if (req.url === '/api/history' && req.method === 'DELETE') { state.history=[]; save(); return json(res, 200, state); }
    if (req.url === '/' || req.url === '/index.html') { res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); return res.end(html); }
    res.writeHead(404); res.end('Not found');
  } catch (e) { json(res, 400, { error: e.message }); }
});
server.on('upgrade', (req, socket, head) => {
  if (!loginBrowser || !sameOrigin(req) || !req.url.startsWith('/login-browser/')) return socket.destroy();
  const upstream = net.connect(6080, '127.0.0.1', () => {
    const headers = req.rawHeaders.reduce((s, h, i, a) => i % 2 ? s : s + `${h}: ${a[i + 1]}\r\n`, '');
    upstream.write(`GET ${req.url.slice('/login-browser'.length)} HTTP/1.1\r\n${headers}\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});
server.listen(port, () => { console.log(`YouTube Feed Cleaner: http://0.0.0.0:${port}`); loop(); });
