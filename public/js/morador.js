(function () {
  const $ = s => document.querySelector(s);
  const ROTULO = { morador: 'Morador', proprietario: 'Proprietário' };
  let usuario = null, app = null, contatos = null, abaAtual = 'contatos';
  const params = new URLSearchParams(location.search);

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const temBlocos = c => !!(c && Array.isArray(c.blocos) && c.blocos.some(Boolean));
  const andarDe = apto => { const n = parseInt(String(apto), 10); return Number.isFinite(n) && n >= 100 ? Math.floor(n / 100) : 0; };
  const rotuloAndar = n => n ? n + 'º andar' : 'Outros';
  const destinoAviso = a => (!a.bloco || a.bloco === 'todos') ? 'todo o condomínio' : 'bloco ' + a.bloco;
  const rotuloApto = a => `Apto ${a.apto}` + (a.bloco ? ` · Bloco ${a.bloco}` : '');

  function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, 3500); }
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.erro || 'Erro'); return j; });

  // ---------- autenticação
  async function carregarAptos() {
    try {
      const l = await (await fetch('/api/apartamentos')).json();
      const opts = l.map(a => `<option value="${a.apto}">${rotuloApto(a)}</option>`).join('');
      $('#c-apto').innerHTML = opts; $('#e-apto').innerHTML = opts;
      localStorage.setItem('interfone.aptos', opts);
    } catch { const o = localStorage.getItem('interfone.aptos'); if (o) { $('#c-apto').innerHTML = o; $('#e-apto').innerHTML = o; } }
  }
  $('#aba-cad').onclick = () => { $('#form-cad').hidden = false; $('#form-ent').hidden = true; $('#aba-cad').classList.add('ativa'); $('#aba-ent').classList.remove('ativa'); };
  $('#aba-ent').onclick = () => { $('#form-cad').hidden = true; $('#form-ent').hidden = false; $('#aba-ent').classList.add('ativa'); $('#aba-cad').classList.remove('ativa'); };
  $('#form-cad').onsubmit = async e => {
    e.preventDefault(); $('#erro-cad').textContent = '';
    try { const r = await post('/api/registrar', { nome: $('#c-nome').value, apto: $('#c-apto').value, telefone: $('#c-tel').value, papel: $('#c-papel').value }); entrar(r.usuario); }
    catch (err) { $('#erro-cad').textContent = err.message; }
  };
  $('#form-ent').onsubmit = async e => {
    e.preventDefault(); $('#erro-ent').textContent = '';
    try { const r = await post('/api/entrar', { apto: $('#e-apto').value, telefone: $('#e-tel').value }); entrar(r.usuario); }
    catch (err) { $('#erro-ent').textContent = err.message; }
  };
  function entrar(u) {
    usuario = u;
    sessionStorage.setItem('interfone.usuario', JSON.stringify(u)); // por aba: permite testar vários moradores em abas diferentes
    localStorage.setItem('interfone.ultimo', JSON.stringify(u));
    $('#tela-auth').hidden = true; $('#tela-app').hidden = false;
    $('#titulo').firstChild.textContent = u.nome;
    $('#subtitulo').textContent = `Apto ${u.apto}` + (u.bloco ? ` · Bloco ${u.bloco}` : '') + ` · ${ROTULO[u.papel]}`;
    if (u.bloco) {
      $('#nome-bloco').textContent = 'Bloco ' + u.bloco;
      $('#aviso-enviar').textContent = 'Enviar para todos do bloco';
      const dica = $('#aviso-dica'); if (dica) dica.textContent = 'Grupo simples por bloco: texto avisado a todos os moradores online do bloco e à portaria.';
    } else {
      $('#nome-bloco').textContent = 'condomínio';
      $('#aviso-enviar').textContent = 'Enviar para todos';
      const dica = $('#aviso-dica'); if (dica) dica.textContent = 'O texto chega a todos os moradores online e à portaria.';
    }
    document.title = `Interfone — ${u.nome} (${u.apto}/${u.papel === 'morador' ? 'M' : 'P'})`;
    iniciarApp();
  }
  function sair() { sessionStorage.removeItem('interfone.usuario'); localStorage.removeItem('interfone.ultimo'); if (app) app.parar(); location.href = '/morador/'; }
  $('#btn-sair').onclick = sair;

  // ---------- app
  function iniciarApp() {
    app = new Interfone({
      kind: 'morador',
      hello: () => ({ kind: 'morador', userId: usuario.id }),
      onEvent: (tipo, d) => {
        if (tipo === 'conexao') { const p = $('#pill-conexao'); p.hidden = false; p.textContent = d ? 'online' : 'offline'; p.className = 'pill ' + (d ? 'on' : 'off'); if (d) { carregarContatos(); carregarAvisos(); carregarHistorico(); } }
        else if (tipo === 'toast') toast(d.texto);
        else if (tipo === 'contatos:update') carregarContatos();
        else if (tipo === 'aviso') { carregarAvisos(); if (d.aviso.de.nome !== usuario.nome) { toast('📢 ' + d.aviso.texto); app.notificarTexto('Aviso — ' + d.aviso.de.nome, d.aviso.texto); } }
        else if (tipo === 'historico:novo') carregarHistorico();
        else if (tipo === 'erro' && d.codigo === 'usuario_invalido') { toast(d.texto); setTimeout(sair, 1500); }
      }
    });
    window.interfone = app; window.__usuario = usuario;
    app.conectar();
    carregarContatos();
  }

  async function carregarContatos() {
    try { contatos = await (await fetch('/api/contatos')).json(); localStorage.setItem('interfone.contatos', JSON.stringify(contatos)); }
    catch { const c = localStorage.getItem('interfone.contatos'); if (!c) return; contatos = JSON.parse(c); }
    $('#portaria-status').textContent = contatos.portariaOnline ? '● Atendimento disponível' : '○ Ninguém online no painel agora';
    const card = a => {
      const outros = a.moradores.filter(m => m.id !== usuario.id);
      const proprio = a.apto === usuario.apto;
      return `<div class="apto" data-apto="${esc(a.apto)}"><div class="apto-topo"><div><span class="apto-nome">Apto ${esc(a.apto)}</span>${proprio ? ' <span class="apto-bloco">(seu apto)</span>' : ''}</div>
          <button class="ligar-apto precisa-rede" data-apto="${esc(a.apto)}" ${outros.length ? '' : 'disabled'} type="button">📞 Ligar</button></div>
          ${a.moradores.length ? a.moradores.map(m => `<div class="pessoa"><span class="dot ${m.online ? 'on' : ''}"></span><div class="info">${esc(m.nome)}<small>${ROTULO[m.papel]} · ${esc(m.telefone)} · ${m.online ? 'online' : 'offline'}</small></div></div>`).join('') : '<div class="pessoa"><div class="info"><small>Ninguém cadastrado ainda</small></div></div>'}
        </div>`;
    };
    const grupos = new Map();
    for (const a of contatos.apartamentos) {
      const usarBloco = temBlocos(contatos);
      const key = usarBloco ? (a.bloco || '') : String(andarDe(a.apto));
      const titulo = usarBloco ? (a.bloco ? 'Bloco ' + a.bloco : '') : rotuloAndar(andarDe(a.apto));
      if (!grupos.has(key)) grupos.set(key, { titulo, aptos: [] });
      grupos.get(key).aptos.push(a);
    }
    $('#lista-contatos').innerHTML = [...grupos.values()].map(g =>
      (g.titulo ? `<h3 class="grupo-aptos">${esc(g.titulo)}</h3>` : '') + g.aptos.map(card).join('')
    ).join('');
  }
  $('#lista-contatos').onclick = e => {
    const b = e.target.closest('.ligar-apto'); if (!b) return;
    app.ligar({ tipo: 'apto', apto: b.dataset.apto }, 'Apto ' + b.dataset.apto);
  };
  $('#ligar-portaria').onclick = () => app.ligar({ tipo: 'portaria' }, 'Portaria');
  $('#btn-notif').onclick = async () => {
    const p = await Interfone.pedirPermissaoNotificacao();
    toast(p === 'granted' ? 'Notificações ativadas.' : p === 'denied' ? 'Notificações bloqueadas no navegador.' : 'Notificações indisponíveis neste navegador.');
  };

  async function carregarAvisos() {
    try {
      const qs = usuario.bloco ? ('?bloco=' + encodeURIComponent(usuario.bloco)) : '';
      const l = await (await fetch('/api/avisos' + qs)).json();
      $('#lista-avisos').innerHTML = l.length ? l.map(a => `<div class="aviso"><strong>${esc(a.texto)}</strong><small>${esc(a.de.nome)}${a.de.apto ? ' · apto ' + esc(a.de.apto) : ''} · ${esc(destinoAviso(a))} · ${new Date(a.em).toLocaleString('pt-BR')}</small></div>`).join('') : '<div class="vazio">Nenhum aviso ainda.</div>';
    } catch {}
  }
  $('#aviso-enviar').onclick = () => { const t = $('#aviso-texto').value.trim(); if (!t) return; app.enviar({ type: 'aviso', texto: t }); $('#aviso-texto').value = ''; toast(usuario.bloco ? 'Aviso enviado ao bloco.' : 'Aviso enviado ao condomínio.'); };

  const RES = { atendida: 'Atendida', indisponivel: 'Apto indisponível', cancelada: 'Cancelada' };
  async function carregarHistorico() {
    try {
      const l = await (await fetch('/api/historico?apto=' + usuario.apto)).json();
      $('#lista-historico').innerHTML = l.length ? l.map(h => `<div class="hist-item"><span class="tag ${h.resultado}">${RES[h.resultado]}</span>${h.fallback ? '<span class="tag fallback">2º número</span>' : ''}
        <strong>${esc(h.de.nome)}${h.de.apto ? ' (apto ' + esc(h.de.apto) + ')' : ''} → ${h.para.tipo === 'portaria' ? 'Portaria' : 'apto ' + esc(h.para.apto)}</strong>
        <div class="tent">${new Date(h.em).toLocaleString('pt-BR')}${h.atendidaPor ? ' · atendeu: ' + esc(h.atendidaPor.nome) + ' · ' + h.duracaoSeg + 's' : ''}</div></div>`).join('') : '<div class="vazio">Sem ligações ainda.</div>';
    } catch {}
  }

  document.querySelectorAll('.abas [data-aba]').forEach(b => b.onclick = () => {
    abaAtual = b.dataset.aba;
    document.querySelectorAll('.abas [data-aba]').forEach(x => x.classList.toggle('ativa', x === b));
    ['contatos', 'avisos', 'historico'].forEach(n => $('#aba-' + n).hidden = n !== abaAtual);
  });

  // ---------- início
  carregarAptos().then(() => {
    const salvo = sessionStorage.getItem('interfone.usuario');
    const ultimo = localStorage.getItem('interfone.ultimo');
    if (salvo) return entrar(JSON.parse(salvo));
    if (ultimo && params.get('origem') === 'pwa') return entrar(JSON.parse(ultimo)); // app instalado reabre já logado
    if (ultimo) { // aba nova: facilita "Entrar" com o último cadastro
      const u = JSON.parse(ultimo); $('#e-apto').value = u.apto;
      $('#aba-ent').click();
    }
  });
})();
