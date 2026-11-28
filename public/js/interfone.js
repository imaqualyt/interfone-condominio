// Núcleo compartilhado (morador e portaria): WebSocket, chamadas WebRTC, tela de chamada, toque e notificações.
(function () {
  const STUN = 'stun:stun.l.google.com:19302';
  let iceServersCache = [{ urls: STUN }];
  const $ = (s, el = document) => el.querySelector(s);
  const params = new URLSearchParams(location.search);
  const timeoutDemo = Number(params.get('timeout')) || null; // ?timeout=10 encurta o tempo de toque por número
  const soDigitosTel = t => String(t || '').replace(/\D/g, '');
  function formatarTelefoneBR(t) {
    let d = soDigitosTel(t);
    if (!d) return '';
    let prefixo = '';
    if (d.length >= 12 && d.startsWith('55')) { prefixo = '+55 '; d = d.slice(2); }
    if (d.length === 11) return prefixo + '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length === 10) return prefixo + '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return (prefixo + d).trim();
  }
  function hrefTelBR(t) {
    const d = soDigitosTel(t);
    if (!d) return '';
    return d.startsWith('55') ? 'tel:+' + d : 'tel:+55' + d;
  }
  window.formatarTelefoneBR = formatarTelefoneBR;
  window.hrefTelBR = hrefTelBR;
  window.soDigitosTel = soDigitosTel;

  class Interfone {
    constructor({ kind, hello, onEvent }) {
      this.kind = kind; this.hello = hello; this.onEvent = onEvent || (() => {});
      this.iceServers = iceServersCache;
      this.ws = null; this.call = null; this.pc = null; this.stream = null; this.muted = false;
      this.pendingIce = []; this.timerTick = null; this.t0 = null; this.audioCtx = null; this.ringTimer = null;
      this.pingTimer = null; this.ultimoPong = 0;
      this.ice = 'novo'; window.__ice = 'novo';
      this.montarTela();
      this.desbloquearAudio();
    }

    // ------------------------------------------------------------ conexão
    async conectar() {
      this.parado = false;
      try {
        const r = await fetch('/api/config', { cache: 'no-store' });
        const cfg = await r.json();
        if (Array.isArray(cfg.iceServers) && cfg.iceServers.length) {
          iceServersCache = cfg.iceServers;
          this.iceServers = cfg.iceServers;
        }
      } catch (e) { /* o WebSocket ainda tenta */ }
      if (this.parado) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = this.ws = new WebSocket(`${proto}//${location.host}/ws`);
      ws.onmessage = ev => this.receber(JSON.parse(ev.data));
      ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', ...this.hello() }));
      ws.onclose = () => {
        this.pararPing();
        window.__wsOff = true; window.__wsOk = false; window.__atualizarFaixa && window.__atualizarFaixa();
        this.onEvent('conexao', false);
        if (this.call) this.encerrarLocal('Conexão perdida');
        clearTimeout(this.reconectar);
        if (!this.parado) this.reconectar = setTimeout(() => this.conectar(), 2000);
      };
      ws.onerror = () => {};
      if (!this._visibilidade) {
        this._visibilidade = true;
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') this.garantirConexao();
        });
        window.addEventListener('focus', () => this.garantirConexao());
        window.addEventListener('online', () => this.garantirConexao());
      }
    }
    parar() { this.parado = true; this.pararPing(); clearTimeout(this.reconectar); if (this.ws) this.ws.close(); }
    iniciarPing() {
      this.pararPing();
      this.ultimoPong = Date.now();
      this.pingTimer = setInterval(() => {
        if (!this.ws || this.ws.readyState !== 1) return;
        if (this.ultimoPong && Date.now() - this.ultimoPong > 25000) {
          try { this.ws.close(); } catch {}
          return;
        }
        this.enviar({ type: 'ping' });
      }, 10000);
    }
    pararPing() { if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; } }
    garantirConexao() {
      if (this.parado) return;
      if (this.ws && this.ws.readyState === 1 && window.__wsOk) { this.enviar({ type: 'ping' }); return; }
      if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
        try { this.ws.close(); } catch {}
        return;
      }
      clearTimeout(this.reconectar);
      this.conectar();
    }
    enviar(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
    get online() { return this.ws && this.ws.readyState === 1 && window.__wsOk; }

    receber(m) {
      this.ultimoPong = Date.now();
      switch (m.type) {
        case 'hello:ok':
          window.__wsOff = false; window.__wsOk = true; window.__atualizarFaixa && window.__atualizarFaixa();
          if (Array.isArray(m.iceServers) && m.iceServers.length) { iceServersCache = m.iceServers; this.iceServers = m.iceServers; }
          this.iniciarPing();
          this.onEvent('conexao', true);
          break;
        case 'pong':
          this.ultimoPong = Date.now();
          break;
        case 'erro': this.onEvent('erro', m); if (m.codigo === 'usuario_invalido' || m.codigo === 'senha_invalida') this.parar(); else this.aviso(m.texto); break;
        case 'call:started': if (this.call) { this.call.id = m.callId; } break;
        case 'call:status': this.statusChamada(m.texto); break;
        case 'call:incoming': this.chegou(m); break;
        case 'call:answered': this.call && (this.call.por = m.por, this.iniciarRtc(true)); break;
        case 'call:connected': break;
        case 'call:cancel': this.cancelado(m); break;
        case 'call:ended': this.terminou(m); break;
        case 'rtc': this.rtc(m.data); break;
        default: this.onEvent(m.type, m);
      }
    }

    // ------------------------------------------------------------ ações do usuário
    ligar(alvo, rotulo) {
      if (this.call) return;
      if (!this.online) return this.aviso('Sem conexão com o servidor. Aguarde reconectar.');
      this.call = { id: null, dir: 'out', peer: rotulo, estado: 'tocando' };
      this.mostrar({ nome: rotulo, status: 'Chamando…', botoes: ['desligar'], rotulo: 'Cancelar' });
      this.tocarChamando();
      this.enviar({ type: 'call:start', alvo, timeout: timeoutDemo || undefined });
    }
    async atender() {
      const c = this.call; if (!c || c.dir !== 'in' || c.estado !== 'tocando') return;
      this.pararToque(); this.fecharNotificacao(c.id);
      c.estado = 'conectando';
      this.mostrar({ nome: c.peer, status: 'Conectando…', botoes: ['mudo', 'desligar'] });
      try { await this.prepararPc(); } catch (e) { this.aviso('Não foi possível usar o microfone: ' + e.message); return this.desligar(); }
      this.enviar({ type: 'call:answer', callId: c.id });
    }
    recusar() {
      const c = this.call; if (!c || c.dir !== 'in') return;
      this.enviar({ type: 'call:decline', callId: c.id });
      this.pararToque(); this.fecharNotificacao(c.id); this.limpar(); this.esconder();
    }
    desligar() {
      if (!this.call) return;
      this.enviar({ type: 'call:hangup' });
      this.encerrarLocal(this.call.estado === 'tocando' ? 'Chamada cancelada' : 'Chamada encerrada');
    }
    alternarMudo() {
      this.muted = !this.muted;
      if (this.stream) this.stream.getAudioTracks().forEach(t => { t.enabled = !this.muted; });
      const b = $('#chamada-mudo', this.tela); if (b) { b.classList.toggle('ativo', this.muted); b.querySelector('span').textContent = this.muted ? 'Ativar mic' : 'Mudo'; }
    }

    // ------------------------------------------------------------ eventos de chamada
    chegou(m) {
      if (this.call) return;
      const nome = m.de.tipo === 'portaria' ? 'Portaria' : `${m.de.nome} · apto ${m.de.apto}`;
      this.call = { id: m.callId, dir: 'in', peer: nome, estado: 'tocando' };
      const extra = m.perna.total > 1 ? ` (você é o ${m.perna.indice}º número a tocar: ${m.perna.papel === 'morador' ? 'morador' : 'proprietário'})` : '';
      this.mostrar({ nome, status: 'Chamada recebida' + extra, botoes: ['atender', 'recusar'] });
      this.tocarChamada();
      this.notificar(m.callId, 'Chamada do interfone', nome);
      this.onEvent('chamada-recebida', m);
    }
    statusChamada(texto) {
      if (this.call && this.call.dir === 'out') this.mostrar({ nome: this.call.peer, status: texto, botoes: ['desligar'], rotulo: 'Cancelar' });
    }
    cancelado(m) { // tocou para mim e parou (timeout, atendida em outro aparelho, chamador desistiu)
      if (!this.call || this.call.id !== m.callId || this.call.dir !== 'in') return;
      this.pararToque(); this.fecharNotificacao(m.callId);
      const motivos = { timeout: 'Chamada perdida', cancelada: 'Chamada cancelada pelo autor', atendida_em_outro: 'Atendida em outro aparelho', indisponivel: 'Chamada indisponível' };
      this.encerrarLocal(motivos[m.motivo] || 'Chamada encerrada');
    }
    terminou(m) {
      this.pararToque();
      if (this.call) this.encerrarLocal(m.texto || 'Chamada encerrada', m.motivo === 'indisponivel');
    }
    encerrarLocal(texto, destacar) {
      const id = this.call && this.call.id;
      this.pararToque(); this.limpar(); if (id) this.fecharNotificacao(id);
      this.mostrar({ nome: '', status: texto, botoes: [], final: true, destaque: !!destacar });
      clearTimeout(this.escondeTimer);
      this.escondeTimer = setTimeout(() => this.esconder(), destacar ? 3500 : 1800);
      this.onEvent('chamada-fim', { texto });
    }
    limpar() {
      if (this.pc) { try { this.pc.close(); } catch {} this.pc = null; }
      if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
      const a = $('#audio-remoto'); if (a) a.srcObject = null;
      clearInterval(this.timerTick); this.call = null; this.pendingIce = []; this.muted = false;
      this.ice = 'novo'; window.__ice = 'novo';
    }

    // ------------------------------------------------------------ WebRTC
    async prepararPc() {
      this.pc = new RTCPeerConnection({ iceServers: this.iceServers && this.iceServers.length ? this.iceServers : iceServersCache });
      const pc = this.pc;
      pc.onicecandidate = e => { if (e.candidate && this.call) this.enviar({ type: 'rtc', callId: this.call.id, data: { candidate: e.candidate } }); };
      pc.oniceconnectionstatechange = () => {
        this.ice = pc.iceConnectionState; window.__ice = pc.iceConnectionState;
        const el = $('#chamada-ice', this.tela); if (el) el.textContent = 'áudio: ' + pc.iceConnectionState;
        if (['connected', 'completed'].includes(pc.iceConnectionState) && this.call && this.call.estado !== 'ativa') this.ativa();
        if (pc.iceConnectionState === 'failed') this.aviso('Falha na conexão de áudio (pode faltar um servidor TURN).');
      };
      pc.ontrack = e => { const a = $('#audio-remoto'); a.srcObject = e.streams[0]; a.play().catch(() => {}); };
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      this.stream.getAudioTracks().forEach(t => pc.addTrack(t, this.stream));
    }
    async iniciarRtc(ofertante) {
      try {
        await this.prepararPc();
        if (ofertante) {
          const offer = await this.pc.createOffer();
          await this.pc.setLocalDescription(offer);
          this.enviar({ type: 'rtc', callId: this.call.id, data: { sdp: this.pc.localDescription } });
          this.call.estado = 'conectando';
          this.mostrar({ nome: this.call.peer, status: 'Conectando…', botoes: ['mudo', 'desligar'] });
          this.pararToque();
        }
      } catch (e) { this.aviso('Não foi possível usar o microfone: ' + e.message); this.desligar(); }
    }
    async rtc(d) {
      if (!this.pc) { return; }
      try {
        if (d.sdp) {
          await this.pc.setRemoteDescription(d.sdp);
          for (const c of this.pendingIce) await this.pc.addIceCandidate(c);
          this.pendingIce = [];
          if (d.sdp.type === 'offer') {
            const ans = await this.pc.createAnswer();
            await this.pc.setLocalDescription(ans);
            this.enviar({ type: 'rtc', callId: this.call.id, data: { sdp: this.pc.localDescription } });
          }
        } else if (d.candidate) {
          if (this.pc.remoteDescription) await this.pc.addIceCandidate(d.candidate); else this.pendingIce.push(d.candidate);
        }
      } catch (e) { console.warn('rtc', e); }
    }
    ativa() {
      this.call.estado = 'ativa'; this.t0 = Date.now(); this.pararToque();
      this.mostrar({ nome: this.call.peer, status: 'Em chamada', botoes: ['mudo', 'desligar'], timer: true });
      clearInterval(this.timerTick);
      this.timerTick = setInterval(() => {
        const s = Math.floor((Date.now() - this.t0) / 1000);
        const el = $('#chamada-tempo', this.tela); if (el) el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
      }, 500);
      this.onEvent('chamada-ativa', {});
    }

    // ------------------------------------------------------------ tela de chamada
    montarTela() {
      this.tela = document.createElement('div');
      this.tela.id = 'tela-chamada'; this.tela.hidden = true;
      this.tela.innerHTML = `
        <div class="chamada-card">
          <div class="chamada-avatar" id="chamada-avatar">📞</div>
          <div class="chamada-nome" id="chamada-nome"></div>
          <div class="chamada-status" id="chamada-status" role="status" aria-live="polite"></div>
          <div class="chamada-tempo" id="chamada-tempo" hidden>00:00</div>
          <div class="chamada-ice" id="chamada-ice"></div>
          <div class="chamada-botoes">
            <button class="rb verde" id="chamada-atender"><i>📞</i><span>Atender</span></button>
            <button class="rb vermelho" id="chamada-recusar"><i>✖</i><span>Recusar</span></button>
            <button class="rb cinza" id="chamada-mudo"><i>🎙️</i><span>Mudo</span></button>
            <button class="rb vermelho" id="chamada-desligar"><i>📵</i><span>Desligar</span></button>
          </div>
        </div>
        <audio id="audio-remoto" autoplay playsinline></audio>`;
      document.body.appendChild(this.tela);
      $('#chamada-atender', this.tela).onclick = () => this.atender();
      $('#chamada-recusar', this.tela).onclick = () => this.recusar();
      $('#chamada-mudo', this.tela).onclick = () => this.alternarMudo();
      $('#chamada-desligar', this.tela).onclick = () => this.desligar();
    }
    mostrar({ nome, status, botoes = [], rotulo, timer, final, destaque }) {
      const t = this.tela; t.hidden = false;
      clearTimeout(this.escondeTimer);
      t.classList.toggle('final', !!final); t.classList.toggle('destaque', !!destaque);
      t.classList.toggle('tocando-entrada', botoes.includes('atender'));
      $('#chamada-nome', t).textContent = nome;
      $('#chamada-status', t).textContent = status;
      $('#chamada-tempo', t).hidden = !timer;
      $('#chamada-ice', t).textContent = '';
      for (const b of ['atender', 'recusar', 'mudo', 'desligar']) $('#chamada-' + b, t).hidden = !botoes.includes(b);
      if (rotulo) $('#chamada-desligar span', t).textContent = rotulo; else $('#chamada-desligar span', t).textContent = 'Desligar';
      $('#chamada-mudo span', t).textContent = this.muted ? 'Ativar mic' : 'Mudo';
    }
    esconder() { this.tela.hidden = true; }
    aviso(texto) { this.onEvent('toast', { texto }); }

    // ------------------------------------------------------------ toque e notificação
    desbloquearAudio() {
      const liberar = () => { this.ctx(); if (this.audioCtx && this.audioCtx.state === 'suspended') this.audioCtx.resume(); };
      ['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, liberar, { passive: true }));
    }
    ctx() { if (!this.audioCtx) { try { this.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } return this.audioCtx; }
    bipe(freqs, dur, vol) {
      const ctx = this.ctx(); if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const g = ctx.createGain(); g.gain.value = 0; g.connect(ctx.destination);
      freqs.forEach(f => { const o = ctx.createOscillator(); o.frequency.value = f; o.type = 'sine'; o.connect(g); o.start(); o.stop(ctx.currentTime + dur); });
      g.gain.setValueAtTime(0, ctx.currentTime); g.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.03);
      g.gain.setValueAtTime(vol, ctx.currentTime + dur - 0.05); g.gain.linearRampToValueAtTime(0, ctx.currentTime + dur);
    }
    tocarChamada() { // toque de quem recebe: duas notas, repetindo
      this.pararToque();
      const toca = () => { this.bipe([880, 1100], 0.9, 0.25); if (navigator.vibrate) navigator.vibrate([400, 200, 400]); };
      toca(); this.ringTimer = setInterval(toca, 2200); window.__tocando = 'entrada';
    }
    tocarChamando() { // retorno de chamada de quem liga
      this.pararToque();
      const toca = () => this.bipe([425], 1.0, 0.08);
      toca(); this.ringTimer = setInterval(toca, 3000); window.__tocando = 'saida';
    }
    pararToque() { clearInterval(this.ringTimer); this.ringTimer = null; window.__tocando = null; if (navigator.vibrate) navigator.vibrate(0); }

    static async pedirPermissaoNotificacao() {
      if (!('Notification' in window)) return 'indisponivel';
      if (Notification.permission === 'default') await Notification.requestPermission();
      return Notification.permission;
    }
    async notificar(id, titulo, corpo) {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const opts = { body: corpo, tag: 'chamada-' + id, icon: '/icons/icon-192.png', requireInteraction: true, vibrate: [300, 150, 300] };
      try {
        const reg = window.__swReg || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
        if (reg && reg.showNotification) await reg.showNotification(titulo, opts);
        else { const n = new Notification(titulo, opts); n.onclick = () => window.focus(); }
        window.__ultimaNotificacao = { titulo, corpo };
      } catch (e) { try { new Notification(titulo, opts); window.__ultimaNotificacao = { titulo, corpo }; } catch {} }
    }
    async fecharNotificacao(id) {
      try {
        const reg = window.__swReg || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
        if (reg) (await reg.getNotifications({ tag: 'chamada-' + id })).forEach(n => n.close());
      } catch {}
    }
    notificarTexto(titulo, corpo) {
      if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
      try { const reg = window.__swReg; if (reg) reg.showNotification(titulo, { body: corpo, icon: '/icons/icon-192.png' }); else new Notification(titulo, { body: corpo }); } catch {}
    }
  }
  window.Interfone = Interfone;
})();
