const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [device, width, height] of [['desktop', 1366, 768], ['tablet', 768, 1024], ['celular', 390, 844]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      let refreshRequests = 0;
      let state = { status:'idle', connection:'connected', enabled:true, autoHide:false, terms:['futebol'], feedVideos:Array.from({length:35}, (_,i) => ({title:`Vídeo ${i} aprender futebol`})), repeatedPhrases:[{phrase:'notícias',count:3}], history:[{title:'Vídeo ocultado',hiddenAt:'2026-01-01T12:00:00Z'}], lastRun:null, lastError:null, intervalMinutes:30 };
      await page.route('http://ui.test/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/state') { if (route.request().method() === 'PUT') state = {...state, ...route.request().postDataJSON()}; return route.fulfill({json:state}); }
        if (url.pathname === '/api/run') { state = {...state, status:'running'}; setTimeout(() => { state = {...state, status:'idle', feedVideos:[{title:'Após execução futebol'}, ...state.feedVideos.slice(1)]}; }, 2500); return route.fulfill({status:202,json:{message:'Execução iniciada'}}); }
        if (url.pathname === '/api/refresh') { refreshRequests++; return route.fulfill({status:202,json:{message:'Atualização iniciada'}}); }
        if (url.pathname === '/api/history') { state.history = []; return route.fulfill({json:state}); }
        return route.fulfill({contentType:'text/html',body:fs.readFileSync('/app/app/public/index.html','utf8')});
      });
      await page.goto('http://ui.test/');
      await page.waitForSelector('#summaryCount:text-is("1")');
      await page.getByRole('button',{name:'Executar agora'}).click();
      assert(await page.locator('#runNow').isDisabled());
      await page.waitForFunction(() => !document.querySelector('#runNow').disabled, null, {timeout:8000});
      await page.getByRole('button',{name:'Vídeos',exact:true}).click();
      assert((await page.locator('#videos .entry').first().innerText()).startsWith('Após execução futebol'));
      await page.getByRole('button',{name:'Visão geral',exact:true}).click();
      state = {...state, status:'running'};
      await page.waitForFunction(() => document.querySelector('#status').textContent === 'Em execução', null, {timeout:5000});
      state = {...state, status:'idle', feedVideos:[{title:'Vídeo atualizado'}, ...state.feedVideos]};
      await page.waitForFunction(() => document.querySelector('#status').textContent === 'Em espera', null, {timeout:5000});
      await page.getByRole('button',{name:'Vídeos',exact:true}).click();
      assert.equal(await page.locator('#videos .entry').first().innerText(), 'Vídeo atualizado');
      state = {...state, feedVideos:[{title:'Atualizado manualmente'}, ...state.feedVideos.slice(1)]};
      await page.getByRole('button',{name:'Atualizar lista'}).click();
      await page.waitForFunction(() => document.querySelector('#refreshMessage').textContent === 'Lista atualizada do YouTube.');
      assert.equal(await page.locator('#videos .entry').first().innerText(), 'Atualizado manualmente');
      assert.equal(refreshRequests, 1);
      await page.reload();
      await page.waitForSelector('#videos .entry');
      assert(await page.locator('#page-videos').isVisible());
      assert.equal(new URL(page.url()).hash, '#videos');
      state = {...state, feedVideos:state.feedVideos.slice(1)};
      await page.waitForFunction(() => document.querySelectorAll('#videos .entry').length === 35, null, {timeout:5000});
      await page.getByRole('button',{name:'Visão geral',exact:true}).click();
      await page.fill('#intervalMinutes','45'); await page.getByRole('button',{name:'Salvar intervalo'}).click();
      await page.waitForFunction(() => document.querySelector('#settingsMessage').textContent.includes('Intervalo salvo'));
      assert.equal(state.intervalMinutes,45);
      await page.getByRole('button',{name:'Vídeos',exact:true}).click();
      await page.locator('#videos .entry').last().scrollIntoViewIfNeeded();
      const box = await page.locator('.video-filter').boundingBox();
      assert(box.y >= 0 && box.y + box.height <= height, `${device}: campo fora da tela`);
      await page.evaluate(() => { const n = document.querySelector('#videos .entry:last-child').firstChild; const i = n.textContent.indexOf('aprender'); const range = document.createRange(); range.setStart(n,i); range.setEnd(n,i+8); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
      assert.equal(await page.inputValue('#videoTerm'),'aprender');
      await page.evaluate(() => load());
      assert.equal(await page.inputValue('#videoTerm'),'aprender');
      await page.getByRole('button',{name:'Adicionar filtro'}).last().click();
      await page.waitForFunction(() => document.querySelector('#videoMessage').textContent === 'Filtro adicionado.');
      assert(state.terms.includes('aprender'));
      assert.equal(await page.locator('#videos .matched').count(),35);
      await page.fill('#videoSearch','não existe');
      assert.equal(await page.locator('#videosEmpty').textContent(),'Nenhum resultado para esta busca.');
      await page.getByRole('button',{name:'Frequentes',exact:true}).click();
      await page.getByRole('button',{name:'Adicionar filtro notícias'}).click();
      await page.waitForFunction(() => document.querySelector('#phraseMessage').textContent === 'Filtro adicionado.');
      assert(state.terms.includes('notícias'));
      await page.getByRole('button',{name:'Histórico',exact:true}).click();
      await page.locator('#clear').click();
      assert(await page.locator('#clearDialog').isVisible());
      await page.locator('#cancelClear').click();
      assert.equal(state.history.length,1);
      await page.locator('#clear').click(); await page.locator('#confirmClear').click();
      await page.waitForFunction(() => document.querySelector('#historyMessage').textContent === 'Histórico limpo.');
      assert.equal(state.history.length,0);
      await page.getByRole('button',{name:'Conexão',exact:true}).click();
      assert(await page.locator('#cookieImport').isVisible());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true,`${device}: rolagem horizontal`);
      console.log(`${device}: navegação, busca, seleção, filtros e histórico OK`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
