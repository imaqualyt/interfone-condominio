// Recados entre um apartamento e a portaria (texto, áudio, foto, vídeo e arquivo).
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const MAX = 10 * 1024 * 1024;

  function headersAuth(extra) {
    const h = Object.assign({}, extra || {});
    if (window.__chatSenha) h['X-Portaria-Senha'] = window.__chatSenha;
    if (window.__chatUserId) h['X-User-Id'] = window.__chatUserId;
    return h;
  }

  function fmtHora(iso) {
    try {
      return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  }

  function rotuloUnidade(apto) {
    return (window.U && U.rotuloUnidade) ? U.rotuloUnidade(apto) : ('Apto ' + apto);
  }

  async function comprimirImagem(file) {
    if (!file || !file.type || !file.type.startsWith('image/') || file.type === 'image/gif') return file;
    try {
      const img = await createImageBitmap(file);
      const max = 1600;
      let w = img.width, h = img.height;
      if (w > max || h > max) {
        const s = Math.min(max / w, max / h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.75));
      if (!blob) return file;
      return new File([blob], (file.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
    } catch { return file; }
  }

  const cacheBlob = new Map();
  async function urlMidia(id) {
    if (cacheBlob.has(id)) return cacheBlob.get(id);
    const r = await fetch('/api/mensagens/midia/' + encodeURIComponent(id), { headers: headersAuth() });
    if (!r.ok) throw new Error('Falha ao baixar anexo');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    cacheBlob.set(id, url);
    return url;
  }

  function cracha(n) {
    n = Number(n) || 0;
    document.querySelectorAll('[data-chat-cracha]').forEach(el => {
      el.hidden = n <= 0;
      el.textContent = n > 99 ? '99+' : String(n);
    });
  }

  const Chat = {
    papel: 'morador',
    apto: null,
    mensagens: [],
    conversas: [],
    gravando: false,
    rec: null,
    recStream: null,
    recChunks: [],

    iniciar({ papel, apto, senha, userId }) {
      this.papel = papel;
      this.apto = apto || null;
      window.__chatSenha = senha || '';
      window.__chatUserId = userId || '';
      this.montarRaiz();
      if (papel === 'portaria') this.carregarConversas();
      else if (apto) this.abrirThread(apto);
      this.carregarNaoLidas();
    },

    montarRaiz() {
      const raiz = $('#chat-raiz');
      if (!raiz || raiz.dataset.pronto) return;
      raiz.dataset.pronto = '1';
      raiz.innerHTML = `
        <div class="chat-layout">
          <div class="chat-lista" id="chat-lista" hidden></div>
          <div class="chat-thread" id="chat-thread">
            <div class="chat-vazio" id="chat-vazio">Escolha uma conversa para começar.</div>
          </div>
        </div>
        <input id="chat-cam" type="file" accept="image/*" capture="environment" hidden>
        <input id="chat-video" type="file" accept="video/*" capture="environment" hidden>
        <input id="chat-galeria" type="file" accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,audio/*" hidden>
      `;
      $('#chat-cam').onchange = async ev => {
        const f = ev.target.files && ev.target.files[0]; ev.target.value = '';
        if (f) await this.enviarArquivo('foto', await comprimirImagem(f));
      };
      $('#chat-video').onchange = async ev => {
        const f = ev.target.files && ev.target.files[0]; ev.target.value = '';
        if (f) await this.enviarArquivo('video', f);
      };
      $('#chat-galeria').onchange = async ev => {
        const f = ev.target.files && ev.target.files[0]; ev.target.value = '';
        if (!f) return;
        const tipo = f.type.startsWith('image/') ? 'foto' : (f.type.startsWith('audio/') ? 'audio' : (f.type.startsWith('video/') ? 'video' : 'arquivo'));
        await this.enviarArquivo(tipo, tipo === 'foto' ? await comprimirImagem(f) : f);
      };
    },

    onEvent(tipo, d) {
      if (tipo === 'mensagem:nova') {
        if (this.apto && d.apto === this.apto) {
          const ja = this.mensagens.some(m => m.id === d.mensagem.id);
          if (!ja) { this.mensagens.push(d.mensagem); this.desenharMsgs(true); }
        }
        if (this.papel === 'portaria') this.carregarConversas();
      }
      if (tipo === 'mensagem:nao-lidas') {
        const n = this.papel === 'portaria' ? (d.total || 0) : (d.total || 0);
        cracha(n);
      }
    },

    async carregarNaoLidas() {
      try {
        const q = this.papel === 'morador' && this.apto ? ('?apto=' + encodeURIComponent(this.apto)) : '';
        const r = await fetch('/api/mensagens/nao-lidas' + q, { headers: headersAuth() });
        const j = await r.json();
        cracha(j.total || 0);
      } catch {}
    },

    async carregarConversas() {
      const lista = $('#chat-lista');
      if (!lista) return;
      lista.hidden = false;
      try {
        const r = await fetch('/api/mensagens/conversas', { headers: headersAuth() });
        const j = await r.json();
        this.conversas = j.conversas || [];
      } catch { this.conversas = this.conversas || []; }
      if (!this.conversas.length) {
        lista.innerHTML = '<p class="dica">Nenhuma conversa ainda. Abra um apartamento abaixo ou pela lista de unidades.</p>' + this.campoAptoPortaria();
        this.ligarCampoApto();
        return;
      }
      lista.innerHTML = this.campoAptoPortaria() + this.conversas.map(c => {
        const ativa = c.apto === this.apto ? ' ativa' : '';
        const n = c.naoLidas ? `<span class="cracha">${c.naoLidas}</span>` : '';
        const prev = (c.ultima && (c.ultima.texto || (c.ultima.midia ? rotuloMidia(c.ultima.midia) : ''))) || '';
        return `<button type="button" class="chat-conv${ativa}" data-apto="${c.apto}">
          <strong>${rotuloUnidade(c.apto)}</strong> ${n}
          <span class="chat-prev">${escapeHtml(prev)}</span>
        </button>`;
      }).join('');
      lista.querySelectorAll('.chat-conv').forEach(b => b.onclick = () => this.abrirThread(b.dataset.apto));
      this.ligarCampoApto();
    },

    campoAptoPortaria() {
      return `<div class="chat-abrir-apto"><input id="chat-apto-novo" placeholder="Abrir conversa (ex.: 116 ou LJ A)" autocomplete="off">
        <button type="button" id="chat-apto-ir">Abrir</button></div>`;
    },
    ligarCampoApto() {
      const ir = () => {
        const v = ($('#chat-apto-novo') && $('#chat-apto-novo').value || '').trim();
        if (v) this.abrirThread(v);
      };
      const btn = $('#chat-apto-ir'); if (btn) btn.onclick = ir;
      const inp = $('#chat-apto-novo'); if (inp) inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ir(); } };
    },

    async abrirThread(apto) {
      this.apto = apto;
      const thread = $('#chat-thread');
      if (!thread) return;
      thread.innerHTML = `
        <div class="chat-topo"><strong>${this.papel === 'portaria' ? rotuloUnidade(apto) : 'Portaria'}</strong></div>
        <div class="chat-msgs" id="chat-msgs"><p class="dica">Carregando…</p></div>
        <div class="chat-composer">
          <button type="button" class="chat-anexo" id="chat-anexo" title="Anexar" aria-label="Anexar">📎</button>
          <div class="chat-menu" id="chat-menu" hidden>
            <button type="button" data-acao="audio">🎤 Gravar áudio</button>
            <button type="button" data-acao="foto">📷 Tirar foto</button>
            <button type="button" data-acao="video">🎥 Gravar vídeo</button>
            <button type="button" data-acao="arquivo">🖼 Anexar da galeria/arquivo</button>
          </div>
          <button type="button" class="chat-rec" id="chat-rec" hidden>Gravando… solte para enviar</button>
          <input id="chat-texto" placeholder="Mensagem" maxlength="4000" autocomplete="off">
          <button type="button" id="chat-enviar">Enviar</button>
        </div>`;
      $('#chat-enviar').onclick = () => this.enviarTexto();
      $('#chat-texto').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.enviarTexto(); } };
      const menu = $('#chat-menu');
      $('#chat-anexo').onclick = ev => { ev.stopPropagation(); menu.hidden = !menu.hidden; };
      document.addEventListener('click', () => { if (menu) menu.hidden = true; });
      menu.querySelectorAll('button').forEach(b => b.onclick = ev => { ev.stopPropagation(); menu.hidden = true; this.acaoAnexo(b.dataset.acao); });
      const recBtn = $('#chat-rec');
      recBtn.onpointerdown = ev => { ev.preventDefault(); this.iniciarGravacao(); };
      recBtn.onpointerup = recBtn.onpointerleave = () => this.pararGravacao(true);
      try {
        const r = await fetch('/api/mensagens?apto=' + encodeURIComponent(apto) + '&marcar=1', { headers: headersAuth() });
        const j = await r.json();
        if (!r.ok) throw new Error(j.erro || 'Falha ao carregar');
        this.mensagens = j.mensagens || [];
        this.desenharMsgs(false);
      } catch (e) {
        $('#chat-msgs').innerHTML = `<p class="erro">${escapeHtml(e.message || 'Falha ao carregar')}</p>`;
      }
      if (this.papel === 'portaria') this.carregarConversas();
      this.carregarNaoLidas();
    },

    desenharMsgs(noFim) {
      const box = $('#chat-msgs');
      if (!box) return;
      if (!this.mensagens.length) {
        box.innerHTML = '<p class="dica">Nenhuma mensagem ainda. Envie um recado para a portaria.</p>';
        return;
      }
      const pertoFim = noFim || (box.scrollHeight - box.scrollTop - box.clientHeight < 80);
      box.innerHTML = this.mensagens.map(m => this.htmlMsg(m)).join('');
      box.querySelectorAll('[data-midia]').forEach(el => this.carregarMidiaEl(el));
      box.querySelectorAll('[data-foto]').forEach(el => el.onclick = () => this.lightbox(el.dataset.foto));
      if (pertoFim) box.scrollTop = box.scrollHeight;
    },

    htmlMsg(m) {
      const eu = (this.papel === 'portaria' && m.de.tipo === 'portaria') || (this.papel === 'morador' && m.de.tipo === 'morador');
      const midia = m.midia ? this.htmlMidia(m.midia) : '';
      const texto = m.texto ? `<div class="chat-texto">${escapeHtml(m.texto)}</div>` : '';
      return `<div class="chat-bolha ${eu ? 'eu' : 'eles'}">
        <div class="chat-meta">${escapeHtml(m.de.nome || m.de.tipo)} · ${fmtHora(m.em)}</div>
        ${texto}${midia}
      </div>`;
    },

    htmlMidia(mid) {
      if (mid.tipo === 'foto' || (mid.mime && mid.mime.startsWith('image/'))) {
        return `<img class="chat-foto" alt="${escapeHtml(mid.nome || 'foto')}" data-midia="${mid.id}" data-foto="${mid.id}">`;
      }
      if (mid.tipo === 'video' || (mid.mime && mid.mime.startsWith('video/'))) {
        return `<video class="chat-video" controls preload="metadata" playsinline data-midia="${mid.id}"></video>`;
      }
      if (mid.tipo === 'audio' || (mid.mime && mid.mime.startsWith('audio/'))) {
        return `<audio class="chat-audio" controls preload="none" data-midia="${mid.id}"></audio>`;
      }
      return `<a class="chat-arq" href="#" data-midia="${mid.id}" data-download="${escapeHtml(mid.nome || 'arquivo')}">⬇ ${escapeHtml(mid.nome || 'arquivo')} (${fmtBytes(mid.bytes)})</a>`;
    },

    async carregarMidiaEl(el) {
      try {
        const url = await urlMidia(el.dataset.midia);
        if (el.tagName === 'IMG' || el.tagName === 'AUDIO' || el.tagName === 'VIDEO') el.src = url;
        else if (el.tagName === 'A') {
          el.href = url;
          el.download = el.dataset.download || 'arquivo';
        }
      } catch {}
    },

    async lightbox(id) {
      try {
        const url = await urlMidia(id);
        let overlay = $('#chat-lightbox');
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.id = 'chat-lightbox';
          overlay.onclick = () => overlay.hidden = true;
          document.body.appendChild(overlay);
        }
        overlay.innerHTML = `<img src="${url}" alt="foto">`;
        overlay.hidden = false;
      } catch {}
    },

    async enviarTexto() {
      const inp = $('#chat-texto');
      const texto = (inp && inp.value || '').trim();
      if (!texto || !this.apto) return;
      inp.value = '';
      try {
        const r = await fetch('/api/mensagens', {
          method: 'POST',
          headers: headersAuth({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ apto: this.apto, texto, tipo: 'texto' })
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.erro || 'Falha ao enviar');
        if (j.mensagem && !this.mensagens.some(m => m.id === j.mensagem.id)) {
          this.mensagens.push(j.mensagem); this.desenharMsgs(true);
        }
      } catch (e) { alert(e.message); }
    },

    async enviarArquivo(tipo, file) {
      if (!file || !this.apto) return;
      if (file.size > MAX) return alert(tipo === 'video' ? 'Vídeo muito grande (máximo 10 MB). Grave um mais curto.' : 'Arquivo maior que 10 MB.');
      const fd = new FormData();
      fd.append('apto', this.apto);
      fd.append('tipo', tipo);
      fd.append('arquivo', file, file.name || 'arquivo');
      try {
        const r = await fetch('/api/mensagens/midia', { method: 'POST', headers: headersAuth(), body: fd });
        const j = await r.json();
        if (!r.ok) throw new Error(j.erro || 'Falha ao enviar');
        if (j.mensagem && !this.mensagens.some(m => m.id === j.mensagem.id)) {
          this.mensagens.push(j.mensagem); this.desenharMsgs(true);
        }
      } catch (e) { alert(e.message); }
    },

    acaoAnexo(acao) {
      if (acao === 'foto') $('#chat-cam').click();
      else if (acao === 'video') $('#chat-video').click();
      else if (acao === 'arquivo') $('#chat-galeria').click();
      else if (acao === 'audio') this.alternarGravacao();
    },

    async alternarGravacao() {
      if (this.gravando) return this.pararGravacao(true);
      await this.iniciarGravacao();
      const recBtn = $('#chat-rec');
      if (recBtn) recBtn.hidden = false;
    },

    async iniciarGravacao() {
      if (this.gravando) return;
      try {
        this.recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        return alert('Permita o microfone para gravar o áudio.');
      }
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 'audio/webm');
      this.recChunks = [];
      this.rec = new MediaRecorder(this.recStream, { mimeType: mime });
      this.rec.ondataavailable = e => { if (e.data && e.data.size) this.recChunks.push(e.data); };
      this.rec.onstop = async () => {
        this.gravando = false;
        if (this.recStream) this.recStream.getTracks().forEach(t => t.stop());
        const recBtn = $('#chat-rec'); if (recBtn) recBtn.hidden = true;
        if (!this._enviarAudio) return;
        const blob = new Blob(this.recChunks, { type: this.rec.mimeType || mime });
        const ext = (mime.indexOf('mp4') >= 0) ? 'm4a' : 'webm';
        await this.enviarArquivo('audio', new File([blob], 'audio.' + ext, { type: blob.type }));
      };
      this._enviarAudio = true;
      this.rec.start();
      this.gravando = true;
      const recBtn = $('#chat-rec'); if (recBtn) recBtn.hidden = false;
    },

    pararGravacao(enviar) {
      this._enviarAudio = !!enviar;
      if (this.rec && this.gravando) {
        try { this.rec.stop(); } catch {}
      }
      this.gravando = false;
    }
  };

  function rotuloMidia(m) {
    if (!m) return '';
    if (m.tipo === 'audio') return '🎤 Áudio';
    if (m.tipo === 'foto') return '📷 Foto';
    if (m.tipo === 'video') return '🎥 Vídeo';
    return '📎 ' + (m.nome || 'Arquivo');
  }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  window.InterfoneChat = Chat;
})();
