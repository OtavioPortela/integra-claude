const statusEl = document.getElementById('status');
const msgEl = document.getElementById('msg');

function refresh() {
  chrome.runtime.sendMessage({ type: 'getStatus' }, (r) => {
    statusEl.textContent = 'Status: ' + (r ? r.status : 'desconhecido');
  });
}

document.getElementById('pair').onclick = () => {
  const code = document.getElementById('code').value;
  chrome.runtime.sendMessage({ type: 'pair', code }, (r) => {
    msgEl.textContent = r && r.ok ? 'Pareado. Conectando…' : (r && r.error) || 'Erro';
    setTimeout(refresh, 1500);
  });
};

refresh();
setInterval(refresh, 2000);
