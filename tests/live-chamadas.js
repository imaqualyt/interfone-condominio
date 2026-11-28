#!/usr/bin/env node
// Teste ao vivo no servidor Render: sinalização (formato exato do app) e, se possível, mídia via TURN (relay).
// Uso: node tests/live-chamadas.js
// Limpa os cadastros de teste ao final (não mexe no apto 539 / Paulo).

const WebSocket = require('ws');
const BASE = process.env.INTERFONE_URL || 'https://interfone-condominio-t64y.onrender.com';
const WS_URL = BASE.replace(/^http/, 'ws') + '/ws';
const SENHA = process.env.PORTARIA_SENHA || '365';
const CHROME = process.env.CHROME || '/usr/bin/google-chrome';

let ok = 0, falhas = 0;
const check = (c, m) => { c ? ok++ : falhas++; console.log(c ? '  ✔' : '  ✘ FALHOU:', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function http(path, { method = 'GET', body, senha } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (senha) headers['X-Portaria-Senha'] = senha;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: r.status, json };
}

async function acordar() {
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) {
    try {
      const r = await http('/api/config');
      if (r.status === 200 && r.json) {
        console.log(`Servidor acordou em ${((Date.now() - t0) / 1000).toFixed(1)}s (persistencia=${r.json.persistencia})`);
        return r.json;
      }
    } catch (e) {
      console.log('  aguardando servidor…', e.message);
    }
    await sleep(4000);
  }
  throw new Error('Servidor não respondeu a /api/config');
}

class Cliente {
  constructor(hello, nome) {
    this.nome = nome;
    this.helloPayload = hello;
    this.msgs = [];
    this.callId = null;
    this.autoAtender = false;
    this.iceServers = [];
    this.ws = new WebSocket(WS_URL);
    this.aberto = new Promise((res, rej) => {
      this.ws.on('open', res);
      this.ws.on('error', rej);
    });
    this.hello = new Promise((res, rej) => {
      this.resolveHello = res;
      this.rejectHello = rej;
      setTimeout(() => rej(new Error(this.nome + ': timeout no hello')), 20000);
    });
    this.ws.on('message', d => this.onMsg(JSON.parse(d.toString())));
    this.ws.on('close', () => { this.fechou = true; });
  }
  async conectar() {
    await this.aberto;
    this.enviar({ type: 'hello', ...this.helloPayload });
    return this.hello;
  }
  enviar(o) { this.ws.send(JSON.stringify(o)); }
  onMsg(m) {
    this.msgs.push(m);
    if (m.type === 'hello:ok') {
      if (Array.isArray(m.iceServers)) this.iceServers = m.iceServers;
      this.resolveHello(m);
    }
    if (m.type === 'erro' && !this._helloOk) this.rejectHello(new Error(this.nome + ': ' + (m.texto || m.codigo)));
    if (m.type === 'hello:ok') this._helloOk = true;
    if (m.type === 'call:started' || m.type === 'call:incoming') this.callId = m.callId;
    if (m.type === 'call:incoming' && this.autoAtender) {
      this.enviar({ type: 'call:answer', callId: m.callId });
    }
  }
  tem(tipo, f = () => true) { return this.msgs.find(m => m.type === tipo && f(m)); }
  async esperar(tipo, f, ms = 15000) {
    const t = Date.now();
    while (Date.now() - t < ms) {
      const m = this.tem(tipo, f);
      if (m) return m;
      await sleep(50);
    }
    throw new Error(`${this.nome}: timeout esperando ${tipo}`);
  }
  limparMsgs() { this.msgs = []; this.callId = null; }
  fechar() { try { this.ws.close(); } catch {} }
}

async function cenarioSinalizacao(nome, chamador, alvoCliente, alvo) {
  console.log('\n' + nome);
  chamador.limparMsgs();
  alvoCliente.limparMsgs();
  alvoCliente.autoAtender = true;
  chamador.enviar({ type: 'call:start', alvo, timeout: 8 });
  const started = await chamador.esperar('call:started');
  check(!!started.callId, `${nome}: call:started (id ${started.callId})`);
  const incoming = await alvoCliente.esperar('call:incoming');
  check(incoming.callId === started.callId, `${nome}: call:incoming no destino com o mesmo callId`);
  check(!!incoming.de, `${nome}: incoming traz origem`);
  const answered = await chamador.esperar('call:answered');
  check(!!answered, `${nome}: call:answered chegou no chamador`);
  const connected = await alvoCliente.esperar('call:connected');
  check(!!connected, `${nome}: call:connected chegou no destino`);

  // Relé de sinalização no formato do app: { type:'rtc', callId, data:{ sdp } } e { data:{ candidate } }
  const oferta = { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n' };
  chamador.enviar({ type: 'rtc', callId: started.callId, data: { sdp: oferta } });
  const rtcOferta = await alvoCliente.esperar('rtc', m => m.data && m.data.sdp && m.data.sdp.type === 'offer');
  check(!!rtcOferta, `${nome}: oferta SDP retransmitida`);

  const resposta = { type: 'answer', sdp: 'v=0\r\no=- 2 1 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\n' };
  alvoCliente.enviar({ type: 'rtc', callId: started.callId, data: { sdp: resposta } });
  const rtcResp = await chamador.esperar('rtc', m => m.data && m.data.sdp && m.data.sdp.type === 'answer');
  check(!!rtcResp, `${nome}: resposta SDP retransmitida`);

  const cand = { candidate: 'candidate:1 1 UDP 12345 1.2.3.4 9 typ host', sdpMid: '0', sdpMLineIndex: 0 };
  chamador.enviar({ type: 'rtc', callId: started.callId, data: { candidate: cand } });
  const rtcIce = await alvoCliente.esperar('rtc', m => m.data && m.data.candidate);
  check(!!rtcIce, `${nome}: candidato ICE retransmitido`);

  chamador.enviar({ type: 'call:hangup', callId: started.callId });
  const fimA = await alvoCliente.esperar('call:ended');
  const fimB = await chamador.esperar('call:ended');
  check(!!fimA && !!fimB, `${nome}: call:ended nos dois lados`);
  alvoCliente.autoAtender = false;
}

async function testePing(cli) {
  console.log('\nPing/pong de aplicação');
  cli.limparMsgs();
  cli.enviar({ type: 'ping' });
  try {
    const pong = await cli.esperar('pong', () => true, 5000);
    check(!!pong, 'servidor responde pong ao ping JSON do app');
  } catch {
    check(false, 'servidor responde pong ao ping JSON do app (ainda não implantado ou falhou)');
  }
}

async function testeTurnPuppeteer(iceServers) {
  console.log('\nTURN (Chrome headless, iceTransportPolicy=relay)');
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); }
  catch (e) {
    check(false, 'puppeteer-core não instalado: ' + e.message);
    return { gather: false, media: false, detalhe: 'sem puppeteer' };
  }
  const fs = require('fs');
  if (!fs.existsSync(CHROME)) {
    check(false, 'Chrome não encontrado em ' + CHROME);
    return { gather: false, media: false, detalhe: 'sem chrome' };
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const resultado = { gather: false, media: false, detalhe: '', candidatos: [], iceA: '', iceB: '' };
  try {
    const page = await browser.newPage();
    page.on('console', msg => {
      const t = msg.text();
      if (t.startsWith('[turn]')) console.log('  ', t);
    });
    await page.goto('about:blank');
    const gather = await page.evaluate(async (iceServers) => {
      const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'relay' });
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        stream.getTracks().forEach(t => pc.addTrack(t, stream));
      } catch (e) {
        pc.addTransceiver('audio', { direction: 'sendrecv' });
      }
      const cands = [];
      const done = new Promise(res => {
        pc.onicecandidate = ev => { if (ev.candidate) cands.push(ev.candidate.toJSON()); };
        pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') res(); };
        setTimeout(res, 12000);
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await done;
      const tipos = {};
      for (const c of cands) {
        const typ = ((c.candidate || '').match(/ typ (\w+)/) || [])[1] || 'other';
        tipos[typ] = (tipos[typ] || 0) + 1;
      }
      pc.close();
      return { count: cands.length, tipos, sample: cands.slice(0, 3) };
    }, iceServers);

    console.log('  candidatos (relay only):', gather.count, gather.tipos);
    resultado.candidatos = gather;
    resultado.gather = gather.count > 0 && (gather.tipos.relay || 0) > 0;
    check(resultado.gather, `coleta de candidatos TURN relay (${gather.count} candidatos, tipos=${JSON.stringify(gather.tipos)})`);

    if (!resultado.gather) {
      resultado.detalhe = 'Open Relay não devolveu candidato relay. TURN está morto ou inacessível desta rede.';
      return resultado;
    }

    // Dois peers no mesmo Chrome, sinalização local, só TURN — prova alocação + conectividade.
    const media = await page.evaluate(async (iceServers) => {
      function ligar(a, b) {
        a.onicecandidate = ev => { if (ev.candidate) b.addIceCandidate(ev.candidate).catch(() => {}); };
        b.onicecandidate = ev => { if (ev.candidate) a.addIceCandidate(ev.candidate).catch(() => {}); };
      }
      const cfg = { iceServers, iceTransportPolicy: 'relay' };
      const a = new RTCPeerConnection(cfg);
      const b = new RTCPeerConnection(cfg);
      ligar(a, b);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        stream.getTracks().forEach(t => a.addTrack(t, stream));
      } catch {
        a.addTransceiver('audio', { direction: 'sendrecv' });
      }
      b.addTransceiver('audio', { direction: 'sendrecv' });
      const estado = { aIce: a.iceConnectionState, bIce: b.iceConnectionState, aConn: a.connectionState, bConn: b.connectionState };
      a.oniceconnectionstatechange = () => { estado.aIce = a.iceConnectionState; };
      b.oniceconnectionstatechange = () => { estado.bIce = b.iceConnectionState; };
      a.onconnectionstatechange = () => { estado.aConn = a.connectionState; };
      b.onconnectionstatechange = () => { estado.bConn = b.connectionState; };
      const offer = await a.createOffer();
      await a.setLocalDescription(offer);
      await b.setRemoteDescription(offer);
      const answer = await b.createAnswer();
      await b.setLocalDescription(answer);
      await a.setRemoteDescription(answer);
      const t0 = Date.now();
      while (Date.now() - t0 < 20000) {
        if (['connected', 'completed'].includes(a.iceConnectionState) && ['connected', 'completed'].includes(b.iceConnectionState)) break;
        if (a.iceConnectionState === 'failed' && b.iceConnectionState === 'failed') break;
        await new Promise(r => setTimeout(r, 200));
      }
      const out = { ...estado, ms: Date.now() - t0 };
      a.close(); b.close();
      return out;
    }, iceServers);

    resultado.iceA = media.aIce;
    resultado.iceB = media.bIce;
    resultado.media = ['connected', 'completed'].includes(media.aIce) || ['connected', 'completed'].includes(media.aConn);
    check(resultado.media, `pares WebRTC via TURN: ice A=${media.aIce} B=${media.bIce} conn A=${media.aConn} B=${media.bConn} (${media.ms}ms)`);
    resultado.detalhe = JSON.stringify(media);
    return resultado;
  } catch (e) {
    check(false, 'teste TURN lançou erro: ' + e.message);
    resultado.detalhe = e.message;
    return resultado;
  } finally {
    await browser.close().catch(() => {});
  }
}

(async () => {
  const idsLimpeza = [];
  const nomesLimpeza = ['Teste Chamada 601', 'Teste Chamada 116'];
  const telsLimpeza = ['21988886001', '21988881116'];
  const clientes = [];
  let turnResult = null;
  try {
    const cfg = await acordar();
    check(cfg.persistencia === 'postgres', 'persistencia=postgres no /api/config');
    check(Array.isArray(cfg.iceServers) && cfg.iceServers.some(s => String(s.urls || '').startsWith('turn:')), `iceServers inclui TURN (${(cfg.iceServers || []).length} entradas)`);

    const r1 = await http('/api/registrar', { method: 'POST', body: { nome: 'Teste Chamada 601', apto: '601', telefone: '21988886001', papel: 'morador' } });
    const r2 = await http('/api/registrar', { method: 'POST', body: { nome: 'Teste Chamada 116', apto: '116', telefone: '21988881116', papel: 'morador' } });
    check(!!(r1.json.usuario && r2.json.usuario), `cadastro dos aptos de teste 601 e 116 (status ${r1.status}/${r2.status})`);
    if (r1.json.usuario) idsLimpeza.push(r1.json.usuario.id);
    if (r2.json.usuario) idsLimpeza.push(r2.json.usuario.id);

    const portaria = new Cliente({ kind: 'portaria', nome: 'Teste Portaria Live', senha: SENHA }, 'portaria');
    const morador601 = new Cliente({ kind: 'morador', userId: r1.json.usuario.id }, 'morador-601');
    const morador116 = new Cliente({ kind: 'morador', userId: r2.json.usuario.id }, 'morador-116');
    clientes.push(portaria, morador601, morador116);
    await Promise.all([portaria.conectar(), morador601.conectar(), morador116.conectar()]);
    check(true, 'hello:ok da portaria e dos dois moradores');

    await testePing(portaria);

    await cenarioSinalizacao('A) Portaria → morador 601', portaria, morador601, { tipo: 'apto', apto: '601' });
    await cenarioSinalizacao('B) Morador 601 → portaria', morador601, portaria, { tipo: 'portaria' });
    await cenarioSinalizacao('C) Morador 601 → morador 116 (apto a apto)', morador601, morador116, { tipo: 'apto', apto: '116' });

    turnResult = await testeTurnPuppeteer(portaria.iceServers.length ? portaria.iceServers : cfg.iceServers);
  } catch (e) {
    falhas++;
    console.log('  ✘ ERRO:', e.stack || e.message);
  }

  for (const c of clientes) c.fechar();
  try {
    const lim = await http('/api/portaria/limpeza', {
      method: 'POST',
      senha: SENHA,
      body: { nomes: nomesLimpeza, telefones: telsLimpeza, usuarioIds: idsLimpeza },
    });
    check(lim.status === 200 && lim.json.ok, `limpeza dos cadastros de teste (removidos=${lim.json.usuariosRemovidos}, status=${lim.status})`);
  } catch (e) {
    check(false, 'limpeza dos cadastros de teste: ' + e.message);
  }

  console.log(`\nResultado: ${ok} verificações OK, ${falhas} falhas`);
  if (turnResult) {
    console.log('TURN:', JSON.stringify({ gather: turnResult.gather, media: turnResult.media, detalhe: turnResult.detalhe, tipos: turnResult.candidatos && turnResult.candidatos.tipos }));
  }
  process.exit(falhas ? 1 : 0);
})();
