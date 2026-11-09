const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

test('execution reads YouTube again after hiding and manual refresh never hides', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'cleaner-refresh-'));
  const modules = path.join(dir,'node_modules/playwright'); fs.mkdirSync(modules,{recursive:true});
  fs.writeFileSync(path.join(dir,'state.json'),JSON.stringify({enabled:false,autoHide:true,terms:['spoiler']}));
  fs.writeFileSync(path.join(modules,'index.js'), `
    const fs = require('node:fs');
    const log = text => fs.appendFileSync(process.env.PROBE_LOG,text+'\\n');
    exports.chromium = { async launchPersistentContext() {
      let reloaded=0;
      const page={async goto(){log('goto')},async reload(){reloaded++;log('reload')},async waitForTimeout(){},async waitForFunction(){},async waitForSelector(){},async evaluate(fn,args){
        if (!args) return true;
        log('scan:'+args.autoHide+':'+Boolean(reloaded));
        if (!args.autoHide && reloaded === 1) return {videos:[{id:'old',title:'spoiler antigo'}],hidden:[]};
        return args.autoHide ? {videos:[{id:'old',title:'spoiler antigo'}],hidden:[{id:'old',title:'spoiler antigo'}]} : {videos:[{id:'fresh',title:reloaded?'Vídeo após ocultar':'Vídeo consultado'}],hidden:[]};
      }};
      return {pages:()=>[page],async close(){await new Promise(r=>setTimeout(r,100))}};
    }};
  `);
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));const base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['app/server.js'],{env:{...process.env,NODE_PATH:path.join(dir,'node_modules'),DATA_FILE:path.join(dir,'state.json'),PROBE_LOG:path.join(dir,'probe.log'),PORT:String(port)},stdio:'ignore'});
  try {
    for(let i=0;i<50;i++){try{await fetch(base+'/api/state');break}catch{await new Promise(r=>setTimeout(r,100))}}
    const post=(url,options={})=>fetch(base+url,{...options,method:options.method||'POST',headers:{origin:base,'content-type':'application/json'}});
    await post('/api/state',{method:'PUT',body:JSON.stringify({enabled:true})});
    assert.equal((await post('/api/run')).status,202);
    assert.equal((await fetch(base+'/api/state').then(r=>r.json())).status,'running');
    let state;
    for(let i=0;i<50;i++){state=await fetch(base+'/api/state').then(r=>r.json());if(state.status==='idle')break;await new Promise(r=>setTimeout(r,25))}
    assert.equal(state.feedVideos[0].title,'Vídeo após ocultar'); assert.equal(state.history[0].id,'old'); const lastRun=state.lastRun;
    await post('/api/state',{method:'PUT',body:JSON.stringify({enabled:false})});
    assert.equal((await post('/api/refresh')).status,202);
    for(let i=0;i<50;i++){state=await fetch(base+'/api/state').then(r=>r.json());if(state.status==='idle')break;await new Promise(r=>setTimeout(r,25))}
    assert.equal(state.feedVideos[0].title,'Vídeo consultado');assert.equal(state.history.length,1);assert.equal(state.lastRun,lastRun);
    assert.deepEqual(fs.readFileSync(path.join(dir,'probe.log'),'utf8').trim().split('\n'),['goto','scan:true:false','reload','scan:false:true','reload','scan:false:true','goto','scan:false:false']);
  } finally {child.kill();await new Promise(r=>child.once('exit',r));fs.rmSync(dir,{recursive:true,force:true})}
});
