(function () {
  const $ = s => document.querySelector(s);
  const ROTULO = { morador: 'Morador', proprietario: 'Proprietário' };
  const params = new URLSearchParams(location.search);
  let app = null, contatos = null, nome = 'Portaria', senha = '';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const temBlocos = c => !!(c && Array.isArray(c.blocos) && c.blocos.some(Boolean));
  const U = window.Unidades;
  const destinoAviso = a => (!a.bloco || a.bloco === 'todos') ? 'todo o condomínio' : 'bloco ' + a.bloco;

  function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 3500); }

  function headersPortaria(extra) {
    return Object.assign({ 'X-Portaria-Senha': senha }, extra || {});
  }
  function abrirPainel() {
    sessionStorage.setItem('interfone.porteiro', JSON.stringify({ nome, senha }));
    $('#tela-entrada').hidden = true; $('#tela-painel').hidden = false;
    $('#subtitulo').textContent = 'Logado como ' + nome;
    document.title = 'Interfone Higino — Portaria (' + nome + ')';
    carregarContatos();
    carregarHistorico();
    carregarAvisos();
  }
  function mostrarErroEntrada(texto) {
    const el = $('#p-erro'); if (el) el.textContent = texto || '';
    const btn = $('#p-entrar'); if (btn) { btn.disabled = false; btn.textContent = 'Abrir painel e receber chamadas'; }
  }
  function entrar() {
    nome = ($('#p-nome').value || 'Portaria').trim();
    senha = ($('#p-senha') && $('#p-senha').value || '').trim();
    mostrarErroEntrada('');
    if (!senha) { mostrarErroEntrada('Informe a senha.'); return; }
    const btn = $('#p-entrar'); if (btn) { btn.disabled = true; btn.textContent = 'Entrando…'; }
    if (app) { app.parar(); app = null; }
    app = new Interfone({
      kind: 'portaria',
      hello: () => ({ kind: 'portaria', nome, senha }),
      onEvent: (tipo, d) => {
        if (tipo === 'conexao') {
          const p = $('#pill-conexao'); p.hidden = false; p.textContent = d ? 'online' : 'offline'; p.className = 'pill ' + (d ? 'on' : 'off');
          if (d) abrirPainel();
        }
        else if (tipo === 'erro' && d.codigo === 'senha_invalida') { mostrarErroEntrada('Senha incorreta'); }
        else if (tipo === 'toast') toast(d.texto);
        else if (tipo === 'contatos:update') carregarContatos();
        else if (tipo === 'historico:novo') carregarHistorico();
        else if (tipo === 'aviso') { carregarAvisos(); }
        else if (tipo === 'portaria:telefone') preencherTelPortaria(d, false);
      }
    });
    window.interfone = app;
    app.conectar();
  }
  $('#p-entrar').onclick = entrar;
  $('#p-nome').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ($('#p-senha') || $('#p-entrar')).focus(); } });
  if ($('#p-senha')) $('#p-senha').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); entrar(); } });

  async function carregarContatos() {
    try { contatos = await (await fetch('/api/contatos')).json(); localStorage.setItem('interfone.contatos', JSON.stringify(contatos)); }
    catch { const c = localStorage.getItem('interfone.contatos'); if (!c) return; contatos = JSON.parse(c); }
    const sel = $('#aviso-bloco');
    const titulo = $('#aviso-titulo');
    if (temBlocos(contatos)) {
      sel.hidden = false;
      sel.innerHTML = '<option value="todos">Todos os blocos</option>' + contatos.blocos.map(b => `<option value="${esc(b)}">Bloco ${esc(b)}</option>`).join('');
      if (titulo) titulo.textContent = 'Aviso para um bloco';
    } else {
      sel.hidden = true;
      sel.innerHTML = '<option value="todos" selected>Todo o condomínio</option>';
      if (titulo) titulo.textContent = 'Aviso ao condomínio';
    }
    desenharAptos();
    preencherTelPortaria(contatos, false);
  }
  function cardApto(a) {
    return `<div class="apto" data-apto="${esc(a.apto)}"><div class="apto-topo"><div><span class="apto-nome">${esc(U.rotuloUnidade(a.apto))}</span>${a.bloco ? ' <span class="apto-bloco">Bloco ' + esc(a.bloco) + '</span>' : ''}</div>
        <button class="ligar-apto precisa-rede" data-apto="${esc(a.apto)}" ${a.moradores.length ? '' : 'disabled'} type="button">📞 Chamar</button></div>
        ${a.moradores.length ? a.moradores.map((m, i) => `<div class="pessoa"><span class="dot ${m.online ? 'on' : ''}"></span><div class="info">${i + 1}º · ${esc(m.nome)}<small>${ROTULO[m.papel]} · ${esc(m.telefone)} · ${m.online ? 'online' : 'offline'}</small></div></div>`).join('') : '<div class="pessoa"><div class="info"><small>Ninguém cadastrado</small></div></div>'}
      </div>`;
  }
  function desenharAptos() {
    if (!contatos) return;
    const q = $('#busca').value.trim();
    const lista = contatos.apartamentos.filter(a => U.corresponde(a.apto, q));
    if (!lista.length) { $('#lista-aptos').innerHTML = '<div class="vazio">Nenhum apartamento encontrado.</div>'; return; }
    const grupos = new Map();
    for (const a of lista) {
      const usarBloco = temBlocos(contatos);
      const key = usarBloco ? (a.bloco || '') : U.chaveGrupo(a.apto);
      const titulo = usarBloco ? (a.bloco ? 'Bloco ' + a.bloco : '') : U.rotuloGrupo(key);
      if (!grupos.has(key)) grupos.set(key, { titulo, aptos: [] });
      grupos.get(key).aptos.push(a);
    }
    $('#lista-aptos').innerHTML = [...grupos.values()].map(g =>
      (g.titulo ? `<h3 class="grupo-aptos">${esc(g.titulo)}</h3>` : '') + '<div class="grade-aptos">' + g.aptos.map(cardApto).join('') + '</div>'
    ).join('');
  }
  $('#busca').oninput = desenharAptos;
  $('#lista-aptos').onclick = e => { const b = e.target.closest('.ligar-apto'); if (b) app.ligar({ tipo: 'apto', apto: b.dataset.apto }, U.rotuloUnidade(b.dataset.apto)); };

  const RES = { atendida: 'Atendida', indisponivel: 'Indisponível', cancelada: 'Não atendida' };
  const TENT = { atendida: 'atendeu', recusada: 'recusou', sem_resposta: 'não atendeu', offline: 'fora do ar', ocupado: 'ocupado', cancelada: 'cancelada' };
  async function carregarHistorico() {
    try {
      const l = await (await fetch('/api/historico', { headers: headersPortaria() })).json();
      $('#lista-historico').innerHTML = l.length ? l.map(h => `<div class="hist-item" data-resultado="${h.resultado}"><span class="tag ${h.resultado}">${RES[h.resultado]}</span>${h.fallback ? '<span class="tag fallback">usou 2º número</span>' : ''}
        <strong>${h.de.tipo === 'portaria' ? 'Portaria' : esc(h.de.nome) + ' (' + esc(U.rotuloUnidade(h.de.apto)) + ')'} → ${h.para.tipo === 'portaria' ? 'Portaria' : esc(U.rotuloUnidade(h.para.apto))}</strong>
        <div class="tent">${U.formatarDataHoraSP(h.em)}${h.atendidaPor ? ' · atendeu: ' + esc(h.atendidaPor.nome) + ' · ' + h.duracaoSeg + 's' : ''}</div>
        <div class="tent">${h.tentativas.map((t, i) => `${i + 1}º ${esc(t.nome)}${t.telefone ? ' ' + esc(t.telefone) : ''}: ${TENT[t.resultado] || '—'}`).join(' → ') || 'sem destinatários'}</div></div>`).join('') : '<div class="vazio">Sem chamadas ainda.</div>';
    } catch {}
  }

  async function carregarAvisos() {
    try {
      const l = await (await fetch('/api/avisos')).json();
      $('#lista-avisos').innerHTML = l.length ? l.map(a => `<div class="aviso"><strong>${esc(a.texto)}</strong><small>${esc(a.de.nome)}${a.de.apto ? ' · apto ' + esc(a.de.apto) : ''} · ${esc(destinoAviso(a))} · ${U.formatarDataHoraSP(a.em)}</small></div>`).join('') : '<div class="vazio">Nenhum aviso ainda.</div>';
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

  let telPortariaSujo = false;
  function preencherTelPortaria(d, forcar) {
    if (!d) return;
    const fmt = d.portariaTelefone || (window.formatarTelefoneBR ? formatarTelefoneBR(d.portariaTelefoneDigitos) : '') || '';
    const atual = $('#tel-portaria-atual');
    if (atual) atual.textContent = fmt ? ('Número atual: ' + fmt) : 'Nenhum número cadastrado ainda.';
    const input = $('#tel-portaria');
    if (input && (forcar || !telPortariaSujo)) input.value = fmt;
  }
  const inputTel = $('#tel-portaria');
  if (inputTel) inputTel.addEventListener('input', () => { telPortariaSujo = true; $('#tel-portaria-ok').hidden = true; $('#tel-portaria-erro').textContent = ''; });
  $('#tel-portaria-salvar').onclick = async () => {
    const erro = $('#tel-portaria-erro'); const ok = $('#tel-portaria-ok');
    erro.textContent = ''; ok.hidden = true;
    const bruto = $('#tel-portaria').value;
    const d = window.soDigitosTel ? soDigitosTel(bruto) : String(bruto || '').replace(/\D/g, '');
    if (d && (d.length < 10 || d.length > 13)) { erro.textContent = 'Telefone inválido (use DDD + número).'; return; }
    try {
      const r = await fetch('/api/portaria/telefone', { method: 'POST', headers: headersPortaria({ 'Content-Type': 'application/json' }), body: JSON.stringify({ telefone: d, senha }) });
      const j = await r.json();
      if (!r.ok) { erro.textContent = j.erro || (r.status === 401 ? 'Senha incorreta' : 'Não foi possível salvar.'); return; }
      telPortariaSujo = false;
      preencherTelPortaria(j, true);
      ok.hidden = false;
      toast('Telefone da portaria salvo.');
    } catch (e) { erro.textContent = 'Sem conexão com o servidor.'; }
  };

  const salvo = sessionStorage.getItem('interfone.porteiro');
  if (salvo) {
    try {
      const o = JSON.parse(salvo);
      if (o && typeof o === 'object') {
        if (o.nome) $('#p-nome').value = o.nome;
        if (o.senha && $('#p-senha')) $('#p-senha').value = o.senha;
        if (o.senha) entrar();
      } else {
        $('#p-nome').value = salvo; // formato antigo: só o nome
      }
    } catch { $('#p-nome').value = salvo; }
  } else if (params.get('nome')) {
    $('#p-nome').value = params.get('nome');
  }
})();
