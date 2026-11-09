// ==UserScript==
// @name         YouTube Feed Cleaner
// @author       rodrigomescua
// @namespace    https://github.com/rodrigomescua/TubeFeedCleaner
// @version      1.0.0
// @description  Gerencie termos e oculte vídeos correspondentes no feed de inscrições.
// @homepageURL  https://github.com/rodrigomescua/TubeFeedCleaner
// @supportURL   https://github.com/rodrigomescua/TubeFeedCleaner/issues
// @updateURL    https://raw.githubusercontent.com/rodrigomescua/TubeFeedCleaner/main/youtube-feed-cleaner.user.js
// @downloadURL  https://raw.githubusercontent.com/rodrigomescua/TubeFeedCleaner/main/youtube-feed-cleaner.user.js
// @license      MIT
// @match        https://www.youtube.com/feed/subscriptions*
// @match        https://www.youtube.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const STORE_TERMS = 'ytfc.terms';
  const STORE_ENABLED = 'ytfc.enabled';
  const STORE_AUTO = 'ytfc.autoHide';
  const STORE_HIDDEN = 'ytfc.hiddenIds';
  const STORE_AUTO_HISTORY = 'ytfc.autoHideHistory';
  const STORE_HIDE_SHORTS = 'ytfc.hideShorts';
  const STORE_HIDE_RELEVANT = 'ytfc.hideRelevant';
  const HOST_ID = 'ytfc-host';
  const PANEL_ID = 'ytfc-panel';
  const BUTTON_ID = 'ytfc-open';
  const VIDEO_SELECTOR = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, yt-lockup-view-model';
  const TITLE_SELECTOR = '#video-title, a#video-title-link, a.yt-lockup-metadata-view-model__title';

  const get = async (key, fallback) => {
    try {
      const value = await GM_getValue(key, fallback);
      return value ?? fallback;
    } catch {
      return fallback;
    }
  };
  const set = async (key, value) => GM_setValue(key, value);

  let terms = [];
  let enabled = true;
  let autoHide = false;
  let hiddenIds = [];
  let autoHideHistory = [];
  let hideShorts = false;
  let hideRelevant = false;
  let scanTimer = 0;
  let feedbackTimer = 0;
  let autoHideInFlight = new WeakSet();
  let autoHideFailed = new WeakSet();
  let autoHideScheduled = new WeakSet();
  let autoHideQueue = Promise.resolve();
  const sectionDisplay = new WeakMap();
  const sectionStyleId = 'ytfc-visual-filter-style';

  const normalize = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
  const onSubscriptions = () => location.pathname.startsWith('/feed/subscriptions');

  function styles(root) {
    const css = `
      #${BUTTON_ID}{position:fixed;right:22px;bottom:22px;z-index:99999;border:0;border-radius:999px;padding:12px 17px;background:#8ab4f8;color:#101114;font:600 14px Roboto,Arial;box-shadow:0 4px 18px #0006;cursor:pointer}
      #${PANEL_ID}{position:fixed;right:22px;bottom:78px;z-index:99999;width:min(370px,calc(100vw - 32px));max-height:min(75vh,680px);overflow:auto;box-sizing:border-box;padding:20px;border:1px solid #3c4048;border-radius:18px;background:#202124;color:#e8eaed;font:14px Roboto,Arial;box-shadow:0 12px 40px #0009}
      #${PANEL_ID}[hidden]{display:none} #${PANEL_ID} *{box-sizing:border-box}
      #ytfc-toast{position:fixed;top:20px;right:22px;max-width:min(380px,calc(100vw - 44px));padding:12px 16px;border:1px solid #5f6368;border-radius:12px;background:#292a2d;color:#e8eaed;font:14px Roboto,Arial;box-shadow:0 5px 22px #0008;opacity:0;transform:translateY(-8px);transition:opacity .18s ease,transform .18s ease;pointer-events:none}#ytfc-toast[data-visible="true"]{opacity:1;transform:translateY(0)}#ytfc-toast[data-type="success"]{border-color:#81c995}#ytfc-toast[data-type="error"]{border-color:#f28b82}
      .ytfc-feedback{padding:9px 11px;border-radius:8px;background:#292a2d;color:#e8eaed;font-size:12px;line-height:1.45}.ytfc-feedback:empty{display:none}
      .ytfc-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.ytfc-head h2{font-size:18px;margin:0}.ytfc-icon{border:0;background:transparent;color:#bdc1c6;font-size:22px;cursor:pointer}
      .ytfc-note{color:#bdc1c6;font-size:12px;line-height:1.5;margin:0 0 14px}.ytfc-row{display:flex;gap:8px;margin:12px 0}.ytfc-row input{min-width:0;flex:1;border:1px solid #5f6368;border-radius:9px;background:#303134;color:#fff;padding:10px 11px;font:inherit}.ytfc-add,.ytfc-action{border:0;border-radius:9px;background:#8ab4f8;color:#101114;padding:9px 12px;font-weight:600;cursor:pointer}.ytfc-switches{display:grid;gap:11px;margin:14px 0;padding:12px;border-radius:12px;background:#292a2d}.ytfc-switches label{display:flex;align-items:center;gap:9px;cursor:pointer}.ytfc-switches input{accent-color:#8ab4f8;width:16px;height:16px}
      .ytfc-history{list-style:none;margin:8px 0;padding:0;display:grid;gap:6px}.ytfc-history li{padding:8px 10px;background:#292a2d;border-radius:8px}.ytfc-history-title{display:block;overflow-wrap:anywhere}.ytfc-history-date{display:block;margin-top:4px;color:#9aa0a6;font-size:11px}.ytfc-section-head{display:flex;align-items:center;justify-content:space-between;margin-top:18px}.ytfc-section-head h3{margin:0;font-size:14px}.ytfc-clear{border:0;background:transparent;color:#8ab4f8;font:inherit;font-size:12px;cursor:pointer}.ytfc-list{list-style:none;margin:12px 0;padding:0;display:grid;gap:7px}.ytfc-list li{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;background:#292a2d;border-radius:9px}.ytfc-term{overflow-wrap:anywhere}.ytfc-remove{border:0;border-radius:7px;background:#3c4043;color:#f1f3f4;padding:6px 9px;cursor:pointer}.ytfc-status{margin:12px 0 0;color:#bdc1c6;font-size:12px}
      .ytfc-match{outline:2px solid #fbbc04!important;outline-offset:2px;border-radius:8px!important}
      .ytfc-inline{display:flex;gap:6px;flex-wrap:wrap;margin:7px 0}.ytfc-inline button{border:0;border-radius:8px;padding:7px 10px;background:#fbbc04;color:#202124;font-weight:600;cursor:pointer}
    `;
    const style = document.createElement('style'); style.textContent = css; root.append(style);
  }

  function pageStyles() {
    if (document.getElementById(sectionStyleId)) return;
    const css = '.ytfc-match{outline:2px solid #fbbc04!important;outline-offset:2px;border-radius:8px!important}.ytfc-inline{display:flex;gap:6px;flex-wrap:wrap;margin:7px 0}.ytfc-inline button{border:0;border-radius:8px;padding:7px 10px;background:#fbbc04;color:#202124;font:600 13px Roboto,Arial;cursor:pointer}';
    if (typeof GM_addStyle === 'function') GM_addStyle(css);
    else { const style = document.createElement('style'); style.id = sectionStyleId; style.textContent = css; document.head.append(style); }
  }

  function makePanel() {
    if (document.getElementById(HOST_ID)) return;
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    button.id = BUTTON_ID; button.type = 'button'; button.textContent = '✦ Limpar feed';
    button.style.pointerEvents = 'auto';
    button.addEventListener('click', () => { const panel = root.getElementById(PANEL_ID); panel.hidden = !panel.hidden; renderPanel(); showToast(panel.hidden ? 'Painel fechado.' : 'Painel aberto.'); });
    const panel = document.createElement('section');
    panel.id = PANEL_ID; panel.hidden = true; panel.setAttribute('aria-label', 'Gerenciador de termos');
    panel.style.pointerEvents = 'auto';
    const toast = document.createElement('div'); toast.id = 'ytfc-toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
    root.append(button, panel, toast);
    styles(root);
    document.body.append(host);
    renderPanel();
  }

  function renderPanel() {
    const panel = document.getElementById(HOST_ID)?.shadowRoot?.getElementById(PANEL_ID);
    if (!panel) return;
    const make = (tag, className, text) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    };

    const header = make('div', 'ytfc-head');
    header.append(make('h2', '', 'Limpar feed'));
    const close = make('button', 'ytfc-icon', '×');
    close.type = 'button'; close.setAttribute('aria-label', 'Fechar');
    close.onclick = () => { panel.hidden = true; };
    header.append(close);
    const feedback = make('p', 'ytfc-feedback', ''); feedback.setAttribute('aria-live', 'polite');

    const note = make('p', 'ytfc-note', 'Adicione palavras ou frases para encontrar vídeos pelo título no feed de inscrições.');
    const form = make('form', 'ytfc-row');
    const termInput = make('input');
    termInput.name = 'term'; termInput.maxLength = 100; termInput.placeholder = 'Ex.: spoilers, futebol';
    termInput.setAttribute('aria-label', 'Novo termo'); termInput.required = true;
    const add = make('button', 'ytfc-add', 'Adicionar'); add.type = 'submit';
    form.append(termInput, add);
    form.onsubmit = async (event) => {
      event.preventDefault();
      const value = termInput.value.trim();
      if (value && !terms.some((term) => normalize(term) === normalize(value))) {
        terms.push(value); await set(STORE_TERMS, terms); renderPanel(); scan(); showToast(`Termo “${value}” adicionado.`, 'success');
      } else if (value) {
        showToast(`O termo “${value}” já está cadastrado.`, 'error');
      }
    };

    const switches = make('div', 'ytfc-switches');
    const enabledLabel = make('label');
    const enabledInput = make('input'); enabledInput.type = 'checkbox'; enabledInput.name = 'enabled'; enabledInput.checked = enabled;
    enabledInput.onchange = async () => { enabled = enabledInput.checked; await set(STORE_ENABLED, enabled); scan(); showToast(enabled ? 'Detecção ativada.' : 'Detecção desativada.', 'success'); };
    enabledLabel.append(enabledInput, document.createTextNode(' Ativar detecção'));
    const autoLabel = make('label');
    const autoInput = make('input'); autoInput.type = 'checkbox'; autoInput.name = 'auto'; autoInput.checked = autoHide;
    autoInput.onchange = async () => { autoHide = autoInput.checked; await set(STORE_AUTO, autoHide); scan(); showToast(autoHide ? 'Ocultação automática ativada.' : 'Ocultação automática desativada.', 'success'); };
    autoLabel.append(autoInput, document.createTextNode(' Ocultar automaticamente (experimental)'));
    switches.append(enabledLabel, autoLabel);

    const visualHeading = make('div', 'ytfc-section-head');
    visualHeading.append(make('h3', '', 'Ocultar seções (só visual)'));
    const visualSwitches = make('div', 'ytfc-switches');
    const visualToggle = (name, text, checked, key, update) => {
      const label = make('label');
      const input = make('input'); input.type = 'checkbox'; input.name = name; input.checked = checked;
      input.onchange = async () => { update(input.checked); await set(key, input.checked); applySectionFilters(); showToast(`${text} ${input.checked ? 'ocultos' : 'visíveis'}.`, 'success'); };
      label.append(input, document.createTextNode(` ${text}`)); visualSwitches.append(label);
    };
    visualToggle('hideShorts', 'Shorts', hideShorts, STORE_HIDE_SHORTS, (value) => { hideShorts = value; });
    visualToggle('hideRelevant', 'Mais relevantes', hideRelevant, STORE_HIDE_RELEVANT, (value) => { hideRelevant = value; });

    const list = make('ul', 'ytfc-list');
    if (terms.length) {
      terms.forEach((term, index) => {
        const item = make('li');
        item.append(make('span', 'ytfc-term', term));
        const remove = make('button', 'ytfc-remove', 'Remover');
        remove.type = 'button';
        remove.onclick = async () => { const [removed] = terms.splice(index, 1); await set(STORE_TERMS, terms); renderPanel(); scan(); showToast(`Termo “${removed}” removido.`, 'success'); };
        item.append(remove); list.append(item);
      });
    } else {
      list.append(make('li', 'ytfc-term', 'Nenhum termo cadastrado ainda.'));
    }

    const historyHeader = make('div', 'ytfc-section-head');
    historyHeader.append(make('h3', '', `Ocultados automaticamente (${autoHideHistory.length})`));
    if (autoHideHistory.length) {
      const clear = make('button', 'ytfc-clear', 'Limpar histórico');
      clear.type = 'button';
      clear.onclick = async () => { autoHideHistory = []; await set(STORE_AUTO_HISTORY, autoHideHistory); renderPanel(); showToast('Histórico apagado.', 'success'); };
      historyHeader.append(clear);
    }
    const historyList = make('ul', 'ytfc-history');
    if (autoHideHistory.length) {
      autoHideHistory.slice().reverse().forEach((entry) => {
        const item = make('li');
        item.append(make('span', 'ytfc-history-title', entry.title || 'Vídeo sem título'));
        item.append(make('time', 'ytfc-history-date', new Date(entry.hiddenAt).toLocaleString()));
        historyList.append(item);
      });
    } else {
      historyList.append(make('li', '', 'Nenhum vídeo ocultado automaticamente ainda.'));
    }

    const status = make('p', 'ytfc-status', onSubscriptions()
      ? 'Os títulos visíveis são analisados automaticamente.'
      : 'Abra youtube.com/feed/subscriptions para analisar o feed.');
    panel.replaceChildren(header, feedback, note, form, switches, visualHeading, visualSwitches, list, historyHeader, historyList, status);
  }

  function showToast(message, type = '') {
    const toast = document.getElementById(HOST_ID)?.shadowRoot?.getElementById('ytfc-toast');
    if (!toast) return;
    toast.textContent = message; toast.dataset.type = type; toast.dataset.visible = 'true';
    clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => { toast.dataset.visible = 'false'; }, 3200);
    const feedback = document.getElementById(HOST_ID)?.shadowRoot?.querySelector('.ytfc-feedback');
    if (feedback) feedback.textContent = message;
  }

  function applySectionFilters() {
    const selectors = 'ytd-rich-section-renderer, ytd-reel-shelf-renderer, ytd-item-section-renderer';
    document.querySelectorAll(selectors).forEach((section) => {
      const heading = normalize(section.querySelector('#title, h2, yt-formatted-string')?.textContent || '');
      const shouldHide = (hideShorts && heading.includes('shorts')) || (hideRelevant && heading.includes('mais relevantes'));
      if (shouldHide) {
        if (!sectionDisplay.has(section)) sectionDisplay.set(section, { value: section.style.getPropertyValue('display'), priority: section.style.getPropertyPriority('display') });
        section.style.setProperty('display', 'none', 'important');
        section.dataset.ytfcVisuallyHidden = 'true';
      } else if (sectionDisplay.has(section)) {
        const original = sectionDisplay.get(section);
        if (original.value) section.style.setProperty('display', original.value, original.priority);
        else section.style.removeProperty('display');
        delete section.dataset.ytfcVisuallyHidden;
        sectionDisplay.delete(section);
      }
    });
  }

  function videoId(card, anchor) {
    const href = anchor?.getAttribute('href') || '';
    const id = new URL(href, location.origin).searchParams.get('v');
    return id || card.getAttribute('data-video-id') || '';
  }

  function titleAnchor(card) {
    return card.querySelector('h3 a[href*="/watch"]')
      || card.querySelector(TITLE_SELECTOR)
      || [...card.querySelectorAll('a[href*="/watch"]')].find((anchor) => (anchor.getAttribute('title') || anchor.textContent || '').trim());
  }

  function titleFor(card) {
    const title = titleAnchor(card) || card.querySelector('h3');
    return (title?.getAttribute('title') || title?.textContent || '').trim();
  }

  function videoCards() {
    const cards = new Set(document.querySelectorAll(VIDEO_SELECTOR));
    document.querySelectorAll('h3').forEach((titleNode) => {
      let card = titleNode.closest(VIDEO_SELECTOR);
      if (!card) {
        let ancestor = titleNode.parentElement;
        while (ancestor && ancestor !== document.body) {
          const hasVideoLink = [...ancestor.querySelectorAll('a[href*="/watch"]')]
            .some((anchor) => (anchor.getAttribute('title') || anchor.textContent || '').trim());
          const hasMenu = ancestor.querySelector('ytd-menu-renderer yt-icon-button, ytd-menu-renderer #button, button[aria-label*="More"], button[aria-label*="Ações"]');
          if (hasVideoLink && hasMenu) { card = ancestor; break; }
          ancestor = ancestor.parentElement;
        }
      }
      if (card) cards.add(card);
    });
    return [...cards];
  }

  function matchingTerm(title) {
    const haystack = normalize(title);
    return terms.find((term) => normalize(term) && haystack.includes(normalize(term)));
  }

  function menuButton(card) {
    const legacyButton = card.querySelector('ytd-menu-renderer yt-icon-button, ytd-menu-renderer #button');
    if (legacyButton) return legacyButton;
    return [...card.querySelectorAll('button, [role="button"], yt-icon-button')]
      .find((button) => /mais acoes|more actions|more options/.test(normalize(button.getAttribute('aria-label') || button.getAttribute('title'))));
  }

  function menuItem(label) {
    return [...document.querySelectorAll('[role="menuitem"], ytd-menu-service-item-renderer, tp-yt-paper-item')]
      .find((el) => normalize(el.innerText || el.textContent).includes(normalize(label)));
  }

  async function hideVideo(card, id, manual = false) {
    if (id && hiddenIds.includes(id)) return;
    if (autoHideInFlight.has(card) || (!manual && autoHideFailed.has(card))) return;
    autoHideInFlight.add(card);
    const menu = menuButton(card);
    if (!menu) {
      autoHideInFlight.delete(card); if (!manual) autoHideFailed.add(card);
      showToast(`Não encontrei o menu para ocultar “${titleFor(card)}”.`, 'error'); return;
    }
    menu.click();
    await new Promise((resolve) => setTimeout(resolve, 350));
    const item = menuItem('Ocultar') || menuItem('Hide');
    if (!item) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      autoHideInFlight.delete(card); if (!manual) autoHideFailed.add(card);
      showToast(`Não encontrei “Ocultar” para “${titleFor(card)}”.`, 'error'); return;
    }
    const title = titleFor(card);
    item.click();
    if (id) { hiddenIds.push(id); hiddenIds = [...new Set(hiddenIds)].slice(-1000); await set(STORE_HIDDEN, hiddenIds); }
    if (!manual) {
      autoHideHistory.push({ id, title, hiddenAt: new Date().toISOString() });
      autoHideHistory = autoHideHistory.slice(-100);
      await set(STORE_AUTO_HISTORY, autoHideHistory);
      renderPanel();
      showToast(`Ocultado automaticamente: “${title}”.`, 'success');
    } else {
      showToast(`Ocultado: “${title}”.`, 'success');
    }
    autoHideInFlight.delete(card);
    card.classList.remove('ytfc-match');
    card.querySelector('.ytfc-inline')?.remove();
    if (manual) scan();
  }

  function queueAutoHide(card, id) {
    if (id && hiddenIds.includes(id)) return;
    if (autoHideInFlight.has(card) || autoHideScheduled.has(card) || autoHideFailed.has(card)) return;
    autoHideScheduled.add(card);
    autoHideQueue = autoHideQueue.then(async () => {
      autoHideScheduled.delete(card);
      await hideVideo(card, id);
    }).catch((error) => {
      autoHideScheduled.delete(card);
      console.error('[YouTube Feed Cleaner] Falha na fila de ocultação:', error);
    });
  }

  function scan() {
    if (scanTimer) return;
    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      if (!onSubscriptions()) return;
      let matchCount = 0;
      videoCards().forEach((card) => {
        const title = titleFor(card);
        const anchor = titleAnchor(card);
        const id = videoId(card, anchor);
        const matched = enabled && title && matchingTerm(title) && !(id && hiddenIds.includes(id));
        if (!matched) {
          card.querySelector('.ytfc-inline')?.remove(); card.classList.remove('ytfc-match');
          return;
        }
        matchCount += 1;
        card.classList.add('ytfc-match');
        if (autoHide) { card.querySelector('.ytfc-inline')?.remove(); queueAutoHide(card, id); return; }
        if (card.querySelector('.ytfc-inline')) return;
        const actions = document.createElement('div'); actions.className = 'ytfc-inline';
        const hide = document.createElement('button'); hide.type = 'button'; hide.textContent = 'Ocultar do feed'; hide.title = 'Aciona “Ocultar” no menu do YouTube';
        hide.onclick = () => hideVideo(card, id, true); actions.append(hide);
        const titleNode = card.querySelector('#details, #meta, h3') || anchor?.parentElement;
        titleNode?.append(actions);
      });
      applySectionFilters();
      const status = document.getElementById(HOST_ID)?.shadowRoot?.querySelector('.ytfc-status');
      if (status) status.textContent = autoHide
        ? `Encontrados ${matchCount} vídeos correspondentes; tentando ocultar automaticamente.`
        : `Encontrados ${matchCount} vídeos correspondentes.`;
    }, 120);
  }

  async function init() {
    terms = await get(STORE_TERMS, []); enabled = await get(STORE_ENABLED, true); autoHide = await get(STORE_AUTO, false); hiddenIds = await get(STORE_HIDDEN, []); autoHideHistory = await get(STORE_AUTO_HISTORY, []); hideShorts = await get(STORE_HIDE_SHORTS, false); hideRelevant = await get(STORE_HIDE_RELEVANT, false);
    if (!Array.isArray(terms)) terms = [];
    if (!Array.isArray(hiddenIds)) hiddenIds = [];
    if (!Array.isArray(autoHideHistory)) autoHideHistory = [];
    pageStyles(); makePanel(); scan();
    applySectionFilters();
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('yt-navigate-finish', () => { renderPanel(); scan(); });
    window.addEventListener('popstate', scan);
  }

  init();
})();
