(function () {
  const $ = s => document.querySelector(s);
  const ROTULO = { morador: 'Morador', proprietario: 'Proprietário' };
  const params = new URLSearchParams(location.search);
  let app = null, contatos = null, nome = 'Portaria';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 3500); }

  function entrar() {
    nome = ($('#p-nome').value || 'Portaria').trim();
    sessionStorage.setItem('interfone.porteiro', nome);
    $('#tela-entrada').hidden = true; $('#tela-painel').hidden = false;
    $('#subtitulo').textContent = 'Logado como ' + nome;
    document.title = 'Interfone — Portaria (' + nome + ')';
    app = new Interfone({
      kind: 'portaria',
      hello: () => ({ kind: 'portaria', nome }),
      onEvent: (tipo, d) => {
        if (tipo === 'conexao') { const p = $('#pill-conexao'); p.hidden = false; p.textContent = d ? 'online' : 'offline'; p.className = 'pill ' + (d ? 'on' : 'off'); if (d) { carregarContatos(); carregarHistorico(); carregarAvisos(); } }
        else if (tipo === 'toast') toast(d.texto);
        else if (tipo === 'contatos:update') carregarContatos();
        else if (tipo === 'historico:novo') carregarHistorico();
        else if (tipo === 'aviso') { carregarAvisos(); }
      }
    });
    window.interfone = app;
    app.conectar();
    carregarContatos();
  }
  $('#p-entrar').onclick = entrar;
  $('#p-nome').addEventListener('keydown', e => { if (e.key === 'Enter') entrar(); });

  async function carregarContatos() {
    try { contatos = await (await fetch('/api/contatos')).json(); localStorage.setItem('interfone.contatos', JSON.stringify(contatos)); }
    catch { const c = localStorage.getItem('interfone.contatos'); if (!c) return; contatos = JSON.parse(c); }
    $('#aviso-bloco').innerHTML = '<option value="todos">Todos os blocos</option>' + contatos.blocos.map(b => `<option value="${esc(b)}">Bloco ${esc(b)}</option>`).join('');
    desenharAptos();
  }
  function desenharAptos() {
    if (!contatos) return;
    const q = $('#busca').value.trim();
    const lista = contatos.apartamentos.filter(a => !q || a.apto.includes(q));
    $('#lista-aptos').innerHTML = lista.length ? lista.map(a => `
      <div class="apto" data-apto="${esc(a.apto)}"><div class="apto-topo"><div><span class="apto-nome">Apto ${esc(a.apto)}</span> <span class="apto-bloco">Bloco ${esc(a.bloco)}</span></div>
        <button class="ligar-apto precisa-rede" data-apto="${esc(a.apto)}" ${a.moradores.length ? '' : 'disabled'} type="button">📞 Chamar</button></div>
        ${a.moradores.length ? a.moradores.map((m, i) => `<div class="pessoa"><span class="dot ${m.online ? 'on' : ''}"></span><div class="info">${i + 1}º · ${esc(m.nome)}<small>${ROTULO[m.papel]} · ${esc(m.telefone)} · ${m.online ? 'online' : 'offline'}</small></div></div>`).join('') : '<div class="pessoa"><div class="info"><small>Ninguém cadastrado</small></div></div>'}
      </div>`).join('') : '<div class="vazio">Nenhum apartamento encontrado.</div>';
  }
  $('#busca').oninput = desenharAptos;
  $('#lista-aptos').onclick = e => { const b = e.target.closest('.ligar-apto'); if (b) app.ligar({ tipo: 'apto', apto: b.dataset.apto }, 'Apto ' + b.dataset.apto); };

  const RES = { atendida: 'Atendida', indisponivel: 'Apto indisponível', cancelada: 'Cancelada' };
  const TENT = { atendida: 'atendeu', recusada: 'recusou', sem_resposta: 'não atendeu', offline: 'fora do ar', ocupado: 'ocupado', cancelada: 'cancelada' };
  async function carregarHistorico() {
    try {
      const l = await (await fetch('/api/historico')).json();
      $('#lista-historico').innerHTML = l.length ? l.map(h => `<div class="hist-item" data-resultado="${h.resultado}"><span class="tag ${h.resultado}">${RES[h.resultado]}</span>${h.fallback ? '<span class="tag fallback">usou 2º número</span>' : ''}
        <strong>${h.de.tipo === 'portaria' ? 'Portaria' : esc(h.de.nome) + ' (apto ' + esc(h.de.apto) + ')'} → ${h.para.tipo === 'portaria' ? 'Portaria' : 'apto ' + esc(h.para.apto)}</strong>
        <div class="tent">${new Date(h.em).toLocaleString('pt-BR')}${h.atendidaPor ? ' · atendeu: ' + esc(h.atendidaPor.nome) + ' · ' + h.duracaoSeg + 's' : ''}</div>
        <div class="tent">${h.tentativas.map((t, i) => `${i + 1}º ${esc(t.nome)}${t.telefone ? ' ' + esc(t.telefone) : ''}: ${TENT[t.resultado] || '—'}`).join(' → ') || 'sem destinatários'}</div></div>`).join('') : '<div class="vazio">Sem chamadas ainda.</div>';
    } catch {}
  }

  async function carregarAvisos() {
    try {
      const l = await (await fetch('/api/avisos')).json();
      $('#lista-avisos').innerHTML = l.length ? l.map(a => `<div class="aviso"><strong>${esc(a.texto)}</strong><small>${esc(a.de.nome)}${a.de.apto ? ' · apto ' + esc(a.de.apto) : ''} · ${a.bloco === 'todos' ? 'todos os blocos' : 'bloco ' + esc(a.bloco)} · ${new Date(a.em).toLocaleString('pt-BR')}</small></div>`).join('') : '<div class="vazio">Nenhum aviso ainda.</div>';
    } catch {}
  }
  $('#aviso-enviar').onclick = () => { const t = $('#aviso-texto').value.trim(); if (!t) return; app.enviar({ type: 'aviso', bloco: $('#aviso-bloco').value, texto: t }); $('#aviso-texto').value = ''; toast('Aviso enviado.'); };
  $('#btn-notif').onclick = async () => {
    const p = await Interfone.pedirPermissaoNotificacao();
    toast(p === 'granted' ? 'Notificações ativadas.' : p === 'denied' ? 'Notificações bloqueadas no navegador.' : 'Notificações indisponíveis.');
  };
  document.querySelectorAll('.abas [data-aba]').forEach(b => b.onclick = () => {
    document.querySelectorAll('.abas [data-aba]').forEach(x => x.classList.toggle('ativa', x === b));
    ['chamar', 'historico', 'avisos'].forEach(n => $('#aba-' + n).hidden = n !== b.dataset.aba);
  });

  const salvo = sessionStorage.getItem('interfone.porteiro');
  if (salvo) { $('#p-nome').value = salvo; entrar(); }
  else if (params.get('nome')) { $('#p-nome').value = params.get('nome'); entrar(); }
})();
