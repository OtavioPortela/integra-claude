// Integra Claude — service worker.
// Conecta ao app local (ws://127.0.0.1) e executa pedidos usando a sessão do ChatGPT já logada.
// FRÁGIL: depende de endpoints internos (/backend-api) e do HTML do campo de mensagem do ChatGPT.
// Toda essa dependência está concentrada nas funções `page*` abaixo.

const CHATGPT = 'https://chatgpt.com';
let ws = null;
let status = 'não pareado';

// ---------- funções injetadas na página (rodam dentro de chatgpt.com) ----------

async function pageApi(path) {
  const s = await fetch('/api/auth/session').then((r) => r.json()).catch(() => ({}));
  if (!s.accessToken) return { error: 'ChatGPT indisponível: faça login em chatgpt.com no Chrome' };
  const r = await fetch(path, { headers: { Authorization: 'Bearer ' + s.accessToken } });
  if (!r.ok) return { error: `ChatGPT respondeu ${r.status} em ${path.split('?')[0]}` };
  return { data: await r.json() };
}

function pageComposerState() {
  const ed = document.querySelector('form div.ProseMirror[contenteditable="true"]'); // caixa de mensagem (não o bloco "Escrita" da conversa)
  const form = ed ? ed.closest('form') : null;
  const btns = form ? [...form.querySelectorAll('button')] : [];
  const busy = btns.some((b) => /stop/i.test(b.dataset.testid || '') || /^(stop|parar|interromper)/i.test(b.getAttribute('aria-label') || ''));
  return { ready: !!ed, busy, draft: ed ? ed.innerText.trim() : '', path: location.pathname };
}

async function pageSend(text, files) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ed = document.querySelector('form div.ProseMirror[contenteditable="true"]'); // caixa de mensagem (não o bloco "Escrita" da conversa)
  if (!ed) return { error: 'Campo de mensagem do ChatGPT não encontrado' };
  const form = ed.closest('form');
  const chips = () => [...form.querySelectorAll('[data-composer-attachments] span[class*="group/composer-attachment"]')];
  // Desfaz o que esta extensão colocou no campo (anexos e texto), para não deixar resíduo.
  const cleanup = async (addedChips) => {
    for (const c of addedChips) {
      const btns = c.querySelectorAll('button');
      if (btns.length) btns[btns.length - 1].click();
      await sleep(150);
    }
    if (ed.innerText.trim()) {
      ed.focus();
      document.execCommand('selectAll');
      document.execCommand('delete');
    }
  };
  // O usuário pediu para enviar: o que estiver na caixa (rascunho ou anexos pendentes) é substituído.
  if (ed.innerText.trim() || chips().length) {
    await cleanup(chips());
    await sleep(400);
    if (ed.innerText.trim() || chips().length) return { error: 'Não consegui limpar a caixa de mensagem do ChatGPT. Nada foi enviado.' };
  }
  ed.focus();
  let added = [];
  if (files && files.length) {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(new File([f.content], f.name, { type: f.mime }));
    ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    const until = Date.now() + 90000;
    let ok = false;
    while (Date.now() < until) {
      await sleep(700);
      added = chips();
      const uploading = form.querySelector('[role="progressbar"], circle[stroke-dasharray], .animate-spin');
      const submit = form.querySelector('button[type="submit"]');
      if (added.length === files.length && !uploading && submit && !submit.disabled) { ok = true; break; }
    }
    if (!ok) {
      await cleanup(chips());
      return { error: `Anexos não carregaram no ChatGPT (${added.length}/${files.length}). Nada foi enviado.` };
    }
    await sleep(1200);
  }
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  await sleep(500);
  const typed = ed.innerText.replace(/\s+/g, ' ').trim();
  const head = text.replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!typed.startsWith(head)) {
    await cleanup(added);
    return { error: 'O texto não entrou corretamente no campo do ChatGPT. Nada foi enviado.' };
  }
  // O botão "Enviar" pode demorar a aparecer (aba em segundo plano, texto longo): espera até 15 s.
  let submit = null;
  for (let i = 0; i < 30; i++) {
    submit = form.querySelector('button[type="submit"]');
    if (submit && !submit.disabled) break;
    await sleep(500);
  }
  if (submit && !submit.disabled) {
    submit.click();
    return { clicked: true };
  }
  // Plano B: Enter no editor (o ChatGPT envia com Enter).
  ed.focus();
  ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
  await sleep(1500);
  if (!ed.innerText.trim()) return { clicked: true };
  const seen = [...form.querySelectorAll('button')].map((b) => `${b.getAttribute('aria-label') || b.type}${b.disabled ? ' (desativado)' : ''}`).join(', ');
  await cleanup(added);
  return { error: `Botão de enviar indisponível no ChatGPT (botões vistos: ${seen || 'nenhum'}). Nada foi enviado.` };
}

// ---------- abas ----------

async function anyChatTab() {
  const tabs = await chrome.tabs.query({ url: CHATGPT + '/*' });
  const ok = tabs.find((t) => t.status === 'complete') || tabs[0];
  if (ok) return ok;
  const t = await chrome.tabs.create({ url: CHATGPT + '/', active: false });
  await waitLoaded(t.id);
  return t;
}

function waitLoaded(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); reject(new Error('ChatGPT demorou para carregar')); }, timeoutMs);
    function fn(id, info) {
      if (id === tabId && info.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(fn); resolve(); }
    }
    chrome.tabs.onUpdated.addListener(fn);
    chrome.tabs.get(tabId).then((t) => { if (t.status === 'complete') fn(tabId, { status: 'complete' }); }).catch(() => {});
  });
}

async function run(tabId, func, args = []) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args, world: 'MAIN' });
  return res ? res.result : undefined;
}

/** Aba com a conversa aberta: usa a que o usuário já tem; senão uma aba de trabalho em segundo plano. */
async function conversationTab(id) {
  const url = `${CHATGPT}/c/${id}`;
  const tabs = await chrome.tabs.query({ url: CHATGPT + '/*' });
  const open = tabs.find((t) => t.url && t.url.split('?')[0] === url);
  if (open) return open;
  const { workerTabId } = await chrome.storage.session.get('workerTabId');
  let tab = null;
  if (workerTabId) tab = await chrome.tabs.get(workerTabId).catch(() => null);
  if (tab) tab = await chrome.tabs.update(tab.id, { url });
  else {
    tab = await chrome.tabs.create({ url, active: false });
    await chrome.storage.session.set({ workerTabId: tab.id });
  }
  await waitLoaded(tab.id);
  return tab;
}

async function waitComposer(tabId, timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const s = await run(tabId, pageComposerState).catch(() => null);
    if (s && s.ready) return s;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Campo de mensagem do ChatGPT não apareceu');
}

// ---------- métodos chamados pelo app ----------

async function api(path) {
  const tab = await anyChatTab();
  const r = await run(tab.id, pageApi, [path]);
  if (!r) throw new Error('Não foi possível acessar a aba do ChatGPT');
  if (r.error) throw new Error(r.error);
  return r.data;
}

const handlers = {
  // Recarrega a extensão depois de atualizar os arquivos (evita ir em chrome://extensions).
  async reload() {
    setTimeout(() => chrome.runtime.reload(), 200);
    return { reloading: true };
  },
  async status() {
    const tabs = await chrome.tabs.query({ url: CHATGPT + '/*' });
    return { chatgptTabs: tabs.length };
  },
  async listConversations({ offset = 0, limit = 28 }) {
    return api(`/backend-api/conversations?offset=${Number(offset)}&limit=${Number(limit)}&order=updated`);
  },
  async getConversation({ id }) {
    if (!/^[\w-]{8,}$/.test(id)) throw new Error('ID de conversa inválido');
    return api(`/backend-api/conversation/${id}`);
  },
  async composerState({ id }) {
    const tabs = await chrome.tabs.query({ url: `${CHATGPT}/c/${id}*` });
    if (!tabs.length) return { busy: false, open: false };
    const s = await run(tabs[0].id, pageComposerState);
    return { busy: !!(s && s.busy), open: true };
  },
  async sendMessage({ id, text, files }) {
    if (!/^[\w-]{8,}$/.test(id)) throw new Error('ID de conversa inválido');
    const tab = await conversationTab(id);
    const state = await waitComposer(tab.id);
    if (state.path !== `/c/${id}`) throw new Error('A aba não está na conversa escolhida (nada foi enviado)');
    if (state.busy) throw new Error('Destino ocupado: o ChatGPT está gerando nessa conversa');
    const r = await run(tab.id, pageSend, [text, files || []]);
    if (!r) throw new Error('Falha ao executar o envio na aba do ChatGPT');
    if (r.error) throw new Error(r.error);
    return r;
  },
};

// ---------- conexão com o app ----------

async function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const { pairing } = await chrome.storage.local.get('pairing');
  if (!pairing) { status = 'não pareado'; return; }
  const sock = new WebSocket(`ws://127.0.0.1:${pairing.port}`);
  ws = sock;
  status = 'conectando';
  sock.onopen = () => sock.send(JSON.stringify({ type: 'hello', role: 'chrome', token: pairing.token, label: 'Chrome' }));
  sock.onmessage = async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'welcome') { status = 'conectado'; return; }
    if (msg.type !== 'req') return;
    const fn = handlers[msg.method];
    try {
      if (!fn) throw new Error(`Método desconhecido: ${msg.method}`);
      const result = await fn(msg.params || {});
      sock.send(JSON.stringify({ type: 'res', id: msg.id, ok: true, result }));
    } catch (e) {
      sock.send(JSON.stringify({ type: 'res', id: msg.id, ok: false, error: String((e && e.message) || e) }));
    }
  };
  sock.onclose = (ev) => {
    if (ws === sock) ws = null;
    status = ev.code === 4003 ? 'código de pareamento inválido' : 'app desconectado';
    setTimeout(connect, 3000);
  };
}

chrome.alarms.create('reconnect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => connect());
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'getStatus') { reply({ status }); return; }
  if (msg.type === 'pair') {
    try {
      const { p, t } = JSON.parse(atob(msg.code.trim()));
      if (!Number.isInteger(p) || typeof t !== 'string' || t.length < 32) throw new Error();
      chrome.storage.local.set({ pairing: { port: p, token: t } }).then(() => {
        if (ws) ws.close();
        ws = null;
        connect();
        reply({ ok: true });
      });
    } catch {
      reply({ ok: false, error: 'Código inválido' });
    }
    return true;
  }
});

connect();
