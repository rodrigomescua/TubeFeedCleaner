const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

test('interval changes reschedule and persist, invalid values are rejected', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleaner-interval-'));
  const moduleDir = path.join(dir, 'node_modules/playwright');
  fs.mkdirSync(moduleDir, {recursive:true});
  fs.writeFileSync(path.join(moduleDir,'index.js'), 'exports.chromium = {};');
  fs.writeFileSync(path.join(dir,'state.json'), JSON.stringify({enabled:false}));
  fs.writeFileSync(path.join(dir,'timers.js'), `const fs=require('node:fs');const original=global.setTimeout;global.setTimeout=(fn,ms,...args)=>{if(ms>=60000)fs.appendFileSync(process.env.TIMER_LOG,ms+'\\n');return original(fn,ms,...args)};`);
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0,'127.0.0.1',resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath,['app/server.js'],{env:{...process.env,NODE_OPTIONS:`--require=${path.join(dir,'timers.js')}`,NODE_PATH:path.join(dir,'node_modules'),DATA_FILE:path.join(dir,'state.json'),TIMER_LOG:path.join(dir,'timers.log'),PORT:String(port),INTERVAL_MINUTES:'30'},stdio:'ignore'});
  try {
    let state;
    for (let i=0;i<50;i++) { try { state=await fetch(base+'/api/state').then(r=>r.json()); break; } catch { await new Promise(r=>setTimeout(r,100)); } }
    assert.equal(state.intervalMinutes,30);
    const update = intervalMinutes => fetch(base+'/api/state',{method:'PUT',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({intervalMinutes})});
    assert.equal((await update(10)).status,200);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'state.json'))).intervalMinutes,10);
    assert.deepEqual(fs.readFileSync(path.join(dir,'timers.log'),'utf8').trim().split('\n').map(Number),[1800000,600000]);
    assert.equal((await update(0)).status,400);
    assert.equal((await update(1.5)).status,400);
    assert.equal((await update(1441)).status,400);
    assert.equal((await fetch(base+'/api/state').then(r=>r.json())).intervalMinutes,10);
  } finally { child.kill(); await new Promise(resolve=>child.once('exit',resolve)); fs.rmSync(dir,{recursive:true,force:true}); }
});
