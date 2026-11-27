// Servidor do interfone: HTTP estático + API REST + WebSocket (sinalização WebRTC e roteamento de chamadas).
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { db, salvar, blocoDe, aptoExiste, apartamentos } = require('./store');

const PORT = Number(process.env.PORT || 5180);
const TIMEOUT_PADRAO = Number(process.env.TIMEOUT || 30); // segundos por número
const PAPEIS = ['morador', 'proprietario'];
const ROTULO = { morador: 'Morador', proprietario: 'Proprietário' };

const app = express();
app.use(express.json());

const uid = () => crypto.randomBytes(6).toString('hex');
const mascarar = t => '••••' + String(t).replace(/\D/g, '').slice(-4);
const soDigitos = t => String(t || '').replace(/\D/g, '');

// Número da portaria: o valor salvo no painel (db.portariaTelefone) sempre prevalece.
// PORTARIA_TELEFONE só entra como padrão quando ainda não houve cadastro nesta instância
// (no plano free do Render o arquivo zera no reinício, e o padrão volta a valer).
function portariaTelefoneAtual() {
  if (Object.prototype.hasOwnProperty.call(db, 'portariaTelefone')) return soDigitos(db.portariaTelefone);
  return soDigitos(process.env.PORTARIA_TELEFONE || '');
}
function formatarTelefone(t) {
  let d = soDigitos(t);
  if (!d) return '';
  let prefixo = '';
  if (d.length >= 12 && d.startsWith('55')) { prefixo = '+55 '; d = d.slice(2); }
  if (d.length === 11) return `${prefixo}(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${prefixo}(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return (prefixo + d).trim();
}
function publicPortariaTel() {
  const d = portariaTelefoneAtual();
  return { portariaTelefone: formatarTelefone(d), portariaTelefoneDigitos: d };
}

// ---------------------------------------------------------------- conexões
const conexoes = new Set(); // ws autenticados
const chamadas = new Map(); // id -> chamada

const enviar = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };
const socketsDoUsuario = id => [...conexoes].filter(w => w.kind === 'morador' && w.userId === id);
const socketsPortaria = () => [...conexoes].filter(w => w.kind === 'portaria');
const publico = u => {
  const o = { id: u.id, nome: u.nome, apto: u.apto, papel: u.papel, telefone: mascarar(u.telefone) };
  if (u.bloco) o.bloco = u.bloco;
  return o;
};

let presencaTimer = null;
function transmitirPresenca() {
  clearTimeout(presencaTimer);
  presencaTimer = setTimeout(() => conexoes.forEach(w => enviar(w, { type: 'contatos:update' })), 150);
}

// ---------------------------------------------------------------- API REST
app.post('/api/registrar', (req, res) => {
  const nome = String(req.body.nome || '').trim();
  const apto = String(req.body.apto || '').trim();
  const papel = String(req.body.papel || '');
  const telefone = soDigitos(req.body.telefone);
  if (nome.length < 2) return res.status(400).json({ erro: 'Informe seu nome.' });
  if (!aptoExiste(apto)) return res.status(400).json({ erro: 'Apartamento não encontrado no condomínio.' });
  if (!PAPEIS.includes(papel)) return res.status(400).json({ erro: 'Escolha: morador ou proprietário.' });
  if (telefone.length < 10 || telefone.length > 13) return res.status(400).json({ erro: 'Telefone inválido (use DDD + número).' });
  const existente = db.usuarios.find(u => u.apto === apto && u.papel === papel);
  if (existente) {
    if (existente.telefone === telefone) return res.json({ usuario: publico(existente), jaCadastrado: true });
    return res.status(409).json({ erro: `Já existe um ${ROTULO[papel].toLowerCase()} cadastrado no apto ${apto} com outro telefone.` });
  }
  const u = { id: uid(), nome, apto, telefone, papel, criadoEm: new Date().toISOString() };
  const bloco = blocoDe(apto);
  if (bloco) u.bloco = bloco;
  db.usuarios.push(u);
  salvar();
  transmitirPresenca();
  res.json({ usuario: publico(u) });
});

app.post('/api/entrar', (req, res) => {
  const apto = String(req.body.apto || '').trim();
  const telefone = soDigitos(req.body.telefone);
  const u = db.usuarios.find(x => x.apto === apto && x.telefone === telefone);
  if (!u) return res.status(404).json({ erro: 'Cadastro não encontrado. Confira apartamento e telefone.' });
  res.json({ usuario: publico(u) });
});

app.get('/api/apartamentos', (req, res) => res.json(apartamentos));

app.get('/api/contatos', (req, res) => {
  const lista = apartamentos.map(a => {
    const item = {
      apto: a.apto,
      moradores: db.usuarios
        .filter(u => u.apto === a.apto)
        .sort((x, y) => PAPEIS.indexOf(x.papel) - PAPEIS.indexOf(y.papel))
        .map(u => ({ ...publico(u), online: socketsDoUsuario(u.id).length > 0 }))
    };
    if (a.bloco) item.bloco = a.bloco;
    return item;
  });
  const blocos = [...new Set(apartamentos.map(a => a.bloco).filter(Boolean))];
  res.json({ apartamentos: lista, portariaOnline: socketsPortaria().length > 0, blocos, ...publicPortariaTel() });
});

app.get('/api/historico', (req, res) => {
  let h = db.historico;
  if (req.query.apto) h = h.filter(x => x.de.apto === req.query.apto || x.para.apto === req.query.apto);
  res.json(h.slice(-100).reverse());
});

app.get('/api/avisos', (req, res) => {
  const b = req.query.bloco;
  res.json(db.avisos.filter(a => !b || a.bloco === 'todos' || a.bloco === b).slice(-30).reverse());
});

app.get('/api/config', (req, res) => res.json({ timeoutPadrao: TIMEOUT_PADRAO, stun: 'stun:stun.l.google.com:19302', ...publicPortariaTel() }));

app.post('/api/portaria/telefone', (req, res) => {
  const telefone = soDigitos(req.body && req.body.telefone);
  if (telefone && (telefone.length < 10 || telefone.length > 13)) {
    return res.status(400).json({ erro: 'Telefone inválido (use DDD + número).' });
  }
  // Grava inclusive vazio: o que o painel salvou substitui PORTARIA_TELEFONE até o reinício.
  db.portariaTelefone = telefone;
  salvar();
  const payload = publicPortariaTel();
  conexoes.forEach(w => enviar(w, { type: 'portaria:telefone', ...payload }));
  transmitirPresenca();
  res.json(payload);
});

// ---------------------------------------------------------------- arquivos estáticos / PWA
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.set('Service-Worker-Allowed', '/');
  res.type('application/javascript').sendFile(path.join(__dirname, 'public', 'sw.js'));
});
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, f) => { if (/\.(json|html|js|css)$/.test(f)) res.set('Cache-Control', 'no-cache'); }
}));

// ---------------------------------------------------------------- roteamento de chamadas
function montarPernas(alvo, chamador) {
  if (alvo.tipo === 'portaria') return [{ portaria: true, nome: 'Portaria', papel: 'porteiro', rotulo: 'Portaria' }];
  return db.usuarios
    .filter(u => u.apto === alvo.apto && u.id !== chamador.userId)
    .sort((a, b) => PAPEIS.indexOf(a.papel) - PAPEIS.indexOf(b.papel)) // 1º morador, 2º proprietário
    .map(u => ({ userId: u.id, nome: u.nome, papel: u.papel, telefone: mascarar(u.telefone), rotulo: `${ROTULO[u.papel]} (${mascarar(u.telefone)})` }));
}

function iniciarChamada(ws, msg) {
  if (ws.callId) return enviar(ws, { type: 'erro', texto: 'Você já está em uma chamada.' });
  const alvo = msg.alvo || {};
  if (alvo.tipo === 'portaria' && ws.kind === 'portaria') return enviar(ws, { type: 'erro', texto: 'A portaria não pode ligar para si mesma.' });
  if (alvo.tipo === 'apto' && !aptoExiste(alvo.apto)) return enviar(ws, { type: 'erro', texto: 'Apartamento inexistente.' });
  if (!['apto', 'portaria'].includes(alvo.tipo)) return enviar(ws, { type: 'erro', texto: 'Destino inválido.' });
  const timeoutSeg = Math.min(120, Math.max(3, Number(msg.timeout) || TIMEOUT_PADRAO));
  const chamador = ws.kind === 'portaria'
    ? { tipo: 'portaria', nome: ws.nome || 'Portaria', apto: null, userId: null }
    : { tipo: 'morador', nome: ws.usuario.nome, apto: ws.usuario.apto, userId: ws.userId };
  const c = {
    id: uid(), ws, chamador, alvo, timeoutSeg, estado: 'tocando',
    pernas: montarPernas(alvo, chamador), idx: -1, pendentes: new Set(), timer: null,
    calleeWs: null, inicio: Date.now(), atendidaEm: null, tentativas: []
  };
  chamadas.set(c.id, c);
  ws.callId = c.id;
  enviar(ws, { type: 'call:started', callId: c.id, timeoutSeg });
  proximaPerna(c);
}

function proximaPerna(c) {
  if (c.estado !== 'tocando') return;
  c.idx++;
  if (c.idx >= c.pernas.length) return finalizar(c, 'indisponivel');
  const perna = c.pernas[c.idx];
  const todos = perna.portaria ? socketsPortaria() : socketsDoUsuario(perna.userId);
  const livres = todos.filter(w => !w.callId && w !== c.ws);
  const tentativa = { papel: perna.papel, nome: perna.nome, telefone: perna.telefone || null, resultado: null };
  c.tentativas.push(tentativa);
  if (!livres.length) {
    tentativa.resultado = todos.length ? 'ocupado' : 'offline';
    enviar(c.ws, { type: 'call:status', texto: `${perna.rotulo}: ${tentativa.resultado === 'offline' ? 'fora do ar' : 'ocupado'}.${c.idx + 1 < c.pernas.length ? ' Tentando o próximo número…' : ''}`, tentativa: c.idx + 1, total: c.pernas.length });
    return proximaPerna(c);
  }
  c.pendentes = new Set(livres);
  livres.forEach(w => enviar(w, {
    type: 'call:incoming', callId: c.id, timeoutSeg: c.timeoutSeg,
    de: { nome: c.chamador.nome, apto: c.chamador.apto, tipo: c.chamador.tipo },
    perna: { papel: perna.papel, indice: c.idx + 1, total: c.pernas.length }
  }));
  enviar(c.ws, { type: 'call:status', texto: `Chamando ${perna.rotulo}…`, tentativa: c.idx + 1, total: c.pernas.length, tocando: true });
  c.timer = setTimeout(() => {
    tentativa.resultado = 'sem_resposta';
    c.pendentes.forEach(w => enviar(w, { type: 'call:cancel', callId: c.id, motivo: 'timeout' }));
    c.pendentes.clear();
    enviar(c.ws, { type: 'call:status', texto: `${perna.rotulo} não atendeu.${c.idx + 1 < c.pernas.length ? ' Tentando o próximo número…' : ''}`, tentativa: c.idx + 1, total: c.pernas.length });
    proximaPerna(c);
  }, c.timeoutSeg * 1000);
}

function atender(ws, msg) {
  const c = chamadas.get(msg.callId);
  if (!c || c.estado !== 'tocando' || !c.pendentes.has(ws)) return enviar(ws, { type: 'call:cancel', callId: msg.callId, motivo: 'indisponivel' });
  clearTimeout(c.timer);
  const perna = c.pernas[c.idx];
  c.tentativas[c.idx].resultado = 'atendida';
  c.estado = 'ativa';
  c.calleeWs = ws;
  c.atendidaEm = Date.now();
  c.pendentes.forEach(w => { if (w !== ws) enviar(w, { type: 'call:cancel', callId: c.id, motivo: 'atendida_em_outro' }); });
  c.pendentes.clear();
  ws.callId = c.id;
  const por = { nome: ws.kind === 'portaria' ? (ws.nome || 'Portaria') : ws.usuario.nome, papel: perna.papel };
  c.atendidaPor = por;
  enviar(c.ws, { type: 'call:answered', callId: c.id, por });
  enviar(ws, { type: 'call:connected', callId: c.id });
}

function recusar(ws, msg) {
  const c = chamadas.get(msg.callId);
  if (!c || c.estado !== 'tocando' || !c.pendentes.has(ws)) return;
  c.pendentes.delete(ws);
  if (c.pendentes.size) return; // outros aparelhos/porteiros ainda tocando
  clearTimeout(c.timer);
  const perna = c.pernas[c.idx];
  c.tentativas[c.idx].resultado = 'recusada';
  enviar(c.ws, { type: 'call:status', texto: `${perna.rotulo} recusou.${c.idx + 1 < c.pernas.length ? ' Tentando o próximo número…' : ''}`, tentativa: c.idx + 1, total: c.pernas.length });
  proximaPerna(c);
}

function desligar(ws, motivoSocketFechado) {
  const c = chamadas.get(ws.callId);
  if (!c) return;
  if (c.estado === 'tocando') {
    if (ws === c.ws) { // chamador cancelou
      clearTimeout(c.timer);
      if (c.tentativas[c.idx] && !c.tentativas[c.idx].resultado) c.tentativas[c.idx].resultado = 'cancelada';
      c.pendentes.forEach(w => enviar(w, { type: 'call:cancel', callId: c.id, motivo: 'cancelada' }));
      c.pendentes.clear();
      finalizar(c, 'cancelada');
    }
    return;
  }
  finalizar(c, 'encerrada', ws);
}

function finalizar(c, resultado, quem) {
  if (c.estado === 'fim') return;
  clearTimeout(c.timer);
  const eraAtiva = c.estado === 'ativa';
  c.estado = 'fim';
  const duracaoSeg = eraAtiva ? Math.round((Date.now() - c.atendidaEm) / 1000) : 0;
  const texto = resultado === 'indisponivel' ? 'Apto indisponível' : resultado === 'cancelada' ? 'Chamada cancelada' : 'Chamada encerrada';
  const entrada = {
    id: c.id, em: new Date(c.inicio).toISOString(),
    de: { tipo: c.chamador.tipo, nome: c.chamador.nome, apto: c.chamador.apto },
    para: { tipo: c.alvo.tipo, apto: c.alvo.apto || null },
    tentativas: c.tentativas,
    resultado: resultado === 'encerrada' ? 'atendida' : resultado,
    atendidaPor: c.atendidaPor || null,
    fallback: c.tentativas.length > 1,
    duracaoSeg
  };
  db.historico.push(entrada);
  if (db.historico.length > 500) db.historico.shift();
  salvar();
  [c.ws, c.calleeWs].forEach(w => {
    if (!w) return;
    w.callId = null;
    if (w !== quem) enviar(w, { type: 'call:ended', callId: c.id, motivo: resultado, texto });
  });
  if (quem) enviar(quem, { type: 'call:ended', callId: c.id, motivo: resultado, texto, proprio: true });
  chamadas.delete(c.id);
  socketsPortaria().forEach(w => enviar(w, { type: 'historico:novo', entrada }));
  conexoes.forEach(w => { if (w.kind === 'morador' && w.usuario && [c.chamador.apto, c.alvo.apto].includes(w.usuario.apto)) enviar(w, { type: 'historico:novo', entrada }); });
}

function aviso(ws, msg) {
  const texto = String(msg.texto || '').trim().slice(0, 300);
  if (!texto) return;
  let bloco = msg.bloco || 'todos';
  if (ws.kind === 'morador') bloco = ws.usuario.bloco || 'todos'; // sem bloco, avisa o condomínio inteiro
  const a = {
    id: uid(), em: new Date().toISOString(), bloco, texto,
    de: ws.kind === 'portaria' ? { nome: ws.nome || 'Portaria', tipo: 'portaria' } : { nome: ws.usuario.nome, apto: ws.usuario.apto, tipo: 'morador' }
  };
  db.avisos.push(a);
  if (db.avisos.length > 200) db.avisos.shift();
  salvar();
  conexoes.forEach(w => {
    if (w.kind === 'portaria' || bloco === 'todos' || (w.usuario && w.usuario.bloco === bloco)) enviar(w, { type: 'aviso', aviso: a });
  });
}

// ---------------------------------------------------------------- WebSocket
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'hello') {
      if (msg.kind === 'portaria') {
        ws.kind = 'portaria'; ws.nome = String(msg.nome || 'Portaria').slice(0, 40);
      } else {
        const u = db.usuarios.find(x => x.id === msg.userId);
        if (!u) return enviar(ws, { type: 'erro', codigo: 'usuario_invalido', texto: 'Cadastro não encontrado. Entre novamente.' });
        ws.kind = 'morador'; ws.userId = u.id; ws.usuario = u;
      }
      conexoes.add(ws);
      enviar(ws, { type: 'hello:ok', timeoutPadrao: TIMEOUT_PADRAO });
      transmitirPresenca();
      return;
    }
    if (!conexoes.has(ws)) return;
    switch (msg.type) {
      case 'call:start': return iniciarChamada(ws, msg);
      case 'call:answer': return atender(ws, msg);
      case 'call:decline': return recusar(ws, msg);
      case 'call:hangup': return desligar(ws);
      case 'rtc': {
        const c = chamadas.get(msg.callId);
        if (!c || c.estado !== 'ativa') return;
        const destino = ws === c.ws ? c.calleeWs : ws === c.calleeWs ? c.ws : null;
        return enviar(destino, { type: 'rtc', callId: c.id, data: msg.data });
      }
      case 'aviso': return aviso(ws, msg);
    }
  });
  ws.on('close', () => {
    if (!conexoes.has(ws)) return;
    // Se estava tocando como destinatário, trata como "fora do ar"
    chamadas.forEach(c => {
      if (c.estado === 'tocando' && c.pendentes.has(ws)) {
        c.pendentes.delete(ws);
        if (!c.pendentes.size) { clearTimeout(c.timer); c.tentativas[c.idx].resultado = 'offline'; proximaPerna(c); }
      }
    });
    desligar(ws);
    conexoes.delete(ws);
    transmitirPresenca();
  });
});

setInterval(() => wss.clients.forEach(w => { if (!w.isAlive) return w.terminate(); w.isAlive = false; w.ping(); }), 20000);

server.listen(PORT, () => {
  console.log(`\n  Interfone Condomínio rodando em http://localhost:${PORT}`);
  console.log(`    Morador:  http://localhost:${PORT}/morador/`);
  console.log(`    Portaria: http://localhost:${PORT}/portaria/`);
  console.log(`    Tempo por número: ${TIMEOUT_PADRAO}s (use ?timeout=10 na URL para encurtar)\n`);
});
