// Registro do service worker + faixa "sem conexão" + botão de instalar.
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(reg => { window.__swReg = reg; })
        .catch(err => console.warn('Service worker não registrado:', err.message));
    });
  }
  const faixa = document.getElementById('faixa-offline');
  function atualizar() {
    const off = !navigator.onLine;
    const semServidor = !!window.__wsOff || !!window.__srvOff;
    window.__semRede = off;
    if (faixa) {
      faixa.hidden = !off && !semServidor;
      faixa.textContent = off
        ? '📴 Sem internet. A interface abre offline, mas as ligações precisam de conexão.'
        : '⚠️ Sem conexão com o servidor. A interface abre offline, mas as ligações só voltam quando a conexão voltar.';
    }
    document.body.classList.toggle('offline', off || semServidor);
  }
  window.addEventListener('online', atualizar);
  window.addEventListener('offline', atualizar);
  window.__atualizarFaixa = atualizar;
  // Verifica se o servidor responde (também na tela de cadastro, quando ainda não há WebSocket)
  function checarServidor() {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 4000);
    fetch('/api/config', { cache: 'no-store', signal: c.signal })
      .then(r => { window.__srvOff = !r.ok; })
      .catch(() => { window.__srvOff = true; })
      .finally(() => { clearTimeout(t); atualizar(); });
  }
  checarServidor(); setInterval(checarServidor, 5000);
  atualizar();

  // Botão "Instalar app" (Chrome/Android dispara beforeinstallprompt)
  let prompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); prompt = e;
    const b = document.getElementById('btn-instalar'); if (b) b.hidden = false;
  });
  document.addEventListener('click', e => {
    if (e.target && e.target.id === 'btn-instalar' && prompt) { prompt.prompt(); prompt = null; e.target.hidden = true; }
  });
})();
