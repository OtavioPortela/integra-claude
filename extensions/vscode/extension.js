// Ponte VS Code ↔ app Integra Claude.
// Conecta no servidor local do app (127.0.0.1, token em ~/.integra-claude/bridge.json),
// lista os terminais integrados (pelo PID do shell) e digita mensagens no terminal escolhido.
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BRIDGE_FILE = path.join(os.homedir(), '.integra-claude', 'bridge.json');
const RECONNECT_MS = 3000;
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

let ws = null;
let state = 'desconectado';
let timer = null;
let out;

function log(msg) {
  out.appendLine(`[${new Date().toISOString()}] ${msg}`);
}

function readBridge() {
  try {
    return JSON.parse(fs.readFileSync(BRIDGE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function listTerminals() {
  const items = [];
  for (const t of vscode.window.terminals) {
    let shellPid = null;
    try {
      shellPid = await t.processId;
    } catch {}
    items.push({ name: t.name, shellPid: shellPid ?? null, exited: t.exitStatus !== undefined });
  }
  return items;
}

async function findTerminal(shellPid) {
  for (const t of vscode.window.terminals) {
    try {
      if ((await t.processId) === shellPid) return t;
    } catch {}
  }
  return null;
}

// Digita o texto como colagem (bracketed paste) e confirma com Enter.
// Assim um texto de várias linhas vira UMA mensagem no Claude Code.
async function sendText({ shellPid, text }) {
  if (typeof shellPid !== 'number' || typeof text !== 'string' || !text.trim()) {
    throw new Error('Parâmetros inválidos');
  }
  const term = await findTerminal(shellPid);
  if (!term) throw new Error('Terminal não encontrado nesta janela');
  if (term.exitStatus !== undefined) throw new Error('Terminal encerrado');
  const clean = text.replace(/\x1b\[20[01]~/g, '');
  term.sendText(PASTE_START + clean + PASTE_END, false);
  await new Promise((r) => setTimeout(r, 400));
  term.sendText('\r', false);
  return { delivered: true };
}

// Abre um terminal novo rodando `claude` num diretório escolhido pelo usuário no app
// (usado para sessões de teste; nunca é chamado automaticamente).
async function openClaudeTerminal({ cwd }) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new Error('Diretório inválido');
  }
  const t = vscode.window.createTerminal({ name: `claude ${path.basename(cwd)}`, cwd });
  t.show(true);
  t.sendText('claude', true);
  return { shellPid: await t.processId };
}

const handlers = { listTerminals, sendText, openClaudeTerminal, version: async () => '0.1.1' };

function connect() {
  clearTimeout(timer);
  const bridge = readBridge();
  if (!bridge) {
    state = 'app fechado';
    timer = setTimeout(connect, RECONNECT_MS);
    return;
  }
  if (typeof WebSocket === 'undefined') {
    state = 'WebSocket indisponível nesta versão do VS Code';
    log(state);
    return;
  }
  const sock = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
  ws = sock;
  sock.onopen = () => {
    sock.send(JSON.stringify({
      type: 'hello',
      role: 'vscode',
      token: bridge.token,
      clientId: vscode.env.sessionId,
      label: vscode.workspace.name || 'VS Code',
    }));
    state = 'conectado';
    log('Conectado ao app Integra Claude');
  };
  sock.onmessage = async (ev) => {
    let msg;
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    } catch {
      return;
    }
    if (msg.type !== 'req') return;
    const fn = handlers[msg.method];
    try {
      if (!fn) throw new Error(`Método desconhecido: ${msg.method}`);
      const result = await fn(msg.params || {});
      sock.send(JSON.stringify({ type: 'res', id: msg.id, ok: true, result }));
    } catch (e) {
      sock.send(JSON.stringify({ type: 'res', id: msg.id, ok: false, error: String(e.message || e) }));
    }
  };
  sock.onclose = () => {
    if (ws === sock) {
      state = 'desconectado';
      timer = setTimeout(connect, RECONNECT_MS);
    }
  };
  sock.onerror = () => {};
}

function notifyTerminalsChanged() {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'event', name: 'terminalsChanged' }));
}

function activate(context) {
  out = vscode.window.createOutputChannel('Integra Claude');
  context.subscriptions.push(
    out,
    vscode.commands.registerCommand('integraClaude.status', () =>
      vscode.window.showInformationMessage(`Integra Claude: ${state}`)),
    vscode.window.onDidOpenTerminal(notifyTerminalsChanged),
    vscode.window.onDidCloseTerminal(notifyTerminalsChanged),
    // Só para testes: abre um terminal com `claude` num diretório de teste.
    // Exige o token do app, para que nenhuma página consiga disparar isso.
    vscode.window.registerUriHandler({
      handleUri(uri) {
        const q = new URLSearchParams(uri.query);
        const bridge = readBridge();
        if (uri.path !== '/open-test-session' || !bridge || q.get('token') !== bridge.token) return;
        const cwd = q.get('cwd');
        if (!cwd || !fs.existsSync(cwd)) return;
        const t = vscode.window.createTerminal({ name: `claude (teste) ${path.basename(cwd)}`, cwd });
        t.show(true);
        t.sendText('claude', true);
      },
    }),
    { dispose: () => { clearTimeout(timer); if (ws) ws.close(); } },
  );
  connect();
}

function deactivate() {}

module.exports = { activate, deactivate };
