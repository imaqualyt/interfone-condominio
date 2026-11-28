// API de recados entre um apartamento e a portaria (texto, áudio, foto, vídeo, arquivo).
const multer = require('multer');
const persist = require('./persist');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: persist.MAX_MIDIA }
});

const MIME_POR_EXT = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', '3gp': 'video/3gpp', webm: 'video/webm',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo'
};

// O multipart do app antigo manda application/octet-stream: deduz o tipo pela extensão do nome.
function mimeEfetivo(mime, nome) {
  const m = String(mime || '').toLowerCase();
  if (m && m !== 'application/octet-stream') return m;
  const ext = String(nome || '').toLowerCase().split('.').pop();
  return MIME_POR_EXT[ext] || m || 'application/octet-stream';
}

function autenticar(req, res, { apto, db, senhaPortariaOk, senhaDaReq, normalizarUnidade }) {
  const unidade = apto ? normalizarUnidade(apto) : '';
  const senha = senhaDaReq(req);
  if (senha) {
    if (senhaPortariaOk(senha)) {
      return { tipo: 'portaria', nome: 'Portaria', userId: null, apto: unidade };
    }
    res.status(401).json({ erro: 'Senha incorreta' });
    return null;
  }
  const id = (req.headers['x-user-id'] || (req.body && req.body.userId) || req.query.userId || '').toString();
  const u = db.usuarios.find(x => x.id === id);
  if (!u) {
    res.status(401).json({ erro: 'Não autorizado.' });
    return null;
  }
  if (unidade && normalizarUnidade(u.apto) !== unidade) {
    res.status(403).json({ erro: 'Este recado não é do seu apartamento.' });
    return null;
  }
  return { tipo: 'morador', nome: u.nome, userId: u.id, apto: normalizarUnidade(u.apto) };
}

module.exports = function anexarMensagens(app, ctx) {
  const {
    db, exigirSenhaPortaria, senhaPortariaOk, senhaDaReq,
    normalizarUnidade, aptoExiste, enviar, conexoes, socketsPortaria
  } = ctx;

  async function naoLidasPara(ws) {
    if (ws.kind === 'portaria') return persist.naoLidas({ quem: 'portaria' });
    if (ws.kind === 'morador' && ws.usuario) {
      return persist.naoLidas({ quem: 'morador', apto: normalizarUnidade(ws.usuario.apto) });
    }
    return { total: 0, porApto: {} };
  }

  async function difundirNaoLidas() {
    const jobs = [];
    for (const w of conexoes) {
      jobs.push((async () => {
        try {
          const n = await naoLidasPara(w);
          enviar(w, { type: 'mensagem:nao-lidas', total: n.total, porApto: n.porApto || {} });
        } catch (e) { console.error('nao-lidas:', e.message); }
      })());
    }
    await Promise.all(jobs);
  }

  async function difundirNova(msg) {
    const payload = { type: 'mensagem:nova', mensagem: msg, apto: msg.apto };
    socketsPortaria().forEach(w => enviar(w, payload));
    conexoes.forEach(w => {
      if (w.kind === 'morador' && w.usuario && normalizarUnidade(w.usuario.apto) === msg.apto) {
        enviar(w, payload);
      }
    });
    await difundirNaoLidas();
  }

  // usado no hello:ok
  ctx.naoLidasPara = naoLidasPara;
  ctx.difundirNaoLidas = difundirNaoLidas;

  const autenticarReq = (req, res, apto) =>
    autenticar(req, res, { apto, db, senhaPortariaOk, senhaDaReq, normalizarUnidade });

  app.get('/api/mensagens/conversas', async (req, res) => {
    if (!exigirSenhaPortaria(req, res)) return;
    try {
      res.json({ conversas: await persist.conversas() });
    } catch (e) {
      console.error(e);
      res.status(500).json({ erro: 'Falha ao listar conversas.' });
    }
  });

  app.get('/api/mensagens/nao-lidas', async (req, res) => {
    try {
      if (senhaPortariaOk(senhaDaReq(req))) {
        return res.json(await persist.naoLidas({ quem: 'portaria' }));
      }
      const quem = autenticarReq(req, res, req.query.apto);
      if (!quem) return;
      res.json(await persist.naoLidas({ quem: 'morador', apto: quem.apto }));
    } catch (e) {
      console.error(e);
      res.status(500).json({ erro: 'Falha ao consultar não lidas.' });
    }
  });

  app.get('/api/mensagens', async (req, res) => {
    try {
      const apto = normalizarUnidade(req.query.apto || '');
      if (!aptoExiste(apto)) return res.status(400).json({ erro: 'Apartamento não encontrado.' });
      const quem = autenticarReq(req, res, apto);
      if (!quem) return;
      const lista = await persist.listarMensagens(apto, { depois: req.query.depois, limite: req.query.limite });
      if (String(req.query.marcar) === '1') {
        await persist.marcarLidas(apto, quem.tipo);
        difundirNaoLidas().catch(() => {});
      }
      res.json({ apto, mensagens: lista });
    } catch (e) {
      console.error(e);
      res.status(500).json({ erro: 'Falha ao listar mensagens.' });
    }
  });

  app.post('/api/mensagens/lida', async (req, res) => {
    try {
      const apto = normalizarUnidade((req.body && req.body.apto) || req.query.apto || '');
      if (!aptoExiste(apto)) return res.status(400).json({ erro: 'Apartamento não encontrado.' });
      const quem = autenticarReq(req, res, apto);
      if (!quem) return;
      await persist.marcarLidas(apto, quem.tipo);
      difundirNaoLidas().catch(() => {});
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ erro: 'Falha ao marcar como lida.' });
    }
  });

  async function criarDeReq(req, res, arquivo) {
    const aptoRaw = (req.body && req.body.apto) || req.query.apto || '';
    const apto = normalizarUnidade(aptoRaw);
    if (!aptoExiste(apto)) return res.status(400).json({ erro: 'Apartamento não encontrado.' });
    const quem = autenticarReq(req, res, apto);
    if (!quem) return;
    const texto = String((req.body && req.body.texto) || '').trim();
    let tipo = String((req.body && req.body.tipo) || (arquivo ? 'arquivo' : 'texto'));
    if (!['texto', 'audio', 'foto', 'video', 'arquivo'].includes(tipo)) tipo = arquivo ? 'arquivo' : 'texto';

    let midia = null;
    if (arquivo && arquivo.buffer) {
      const nomeArq = arquivo.originalname || (req.body && req.body.nomeArquivo) || 'arquivo';
      const mimeArq = mimeEfetivo(arquivo.mimetype || (req.body && req.body.mime), nomeArq);
      if (tipo === 'arquivo' && mimeArq.startsWith('video/')) tipo = 'video';
      midia = await persist.gravarMidia({ buffer: arquivo.buffer, mime: mimeArq, nome: nomeArq, tipo });
      midia.tipo = tipo === 'texto'
        ? (String(midia.mime).startsWith('image/') ? 'foto' : (String(midia.mime).startsWith('video/') ? 'video' : 'arquivo'))
        : tipo;
    } else if (req.body && req.body.dados) {
      const b64 = String(req.body.dados).replace(/^data:[^;]+;base64,/, '');
      const buf = Buffer.from(b64, 'base64');
      const nomeB64 = req.body.nomeArquivo || 'arquivo';
      const mimeB64 = mimeEfetivo(req.body.mime, nomeB64);
      tipo = tipo === 'texto' || (tipo === 'arquivo' && mimeB64.startsWith('video/')) ? (mimeB64.startsWith('video/') ? 'video' : 'arquivo') : tipo;
      midia = await persist.gravarMidia({ buffer: buf, mime: mimeB64, nome: nomeB64, tipo });
      midia.tipo = tipo;
    }

    if (!texto && !midia) return res.status(400).json({ erro: 'Escreva uma mensagem ou anexe um arquivo.' });

    const msg = await persist.criarMensagem({
      apto,
      deTipo: quem.tipo,
      deNome: quem.nome,
      deUserId: quem.userId,
      texto,
      midia: midia ? { id: midia.id, tipo: midia.tipo, nome: midia.nome, mime: midia.mime, bytes: midia.bytes } : null
    });
    await difundirNova(msg);
    res.json({ mensagem: msg });
  }

  const tratarErro = (res, e) => {
    if (e && (e.codigo === 413 || e.code === 'LIMIT_FILE_SIZE')) {
      return res.status(413).json({ erro: 'Arquivo maior que 10 MB.' });
    }
    if (e && e.codigo === 400) return res.status(400).json({ erro: e.message });
    console.error(e);
    res.status(500).json({ erro: 'Falha ao enviar mensagem.' });
  };

  app.post('/api/mensagens', async (req, res) => {
    try { await criarDeReq(req, res, null); }
    catch (e) { tratarErro(res, e); }
  });

  app.post('/api/mensagens/midia', (req, res) => {
    upload.single('arquivo')(req, res, async (err) => {
      if (err) return tratarErro(res, err);
      try { await criarDeReq(req, res, req.file); }
      catch (e) { tratarErro(res, e); }
    });
  });

  app.get('/api/mensagens/midia/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '');
      const vinculo = await persist.midiaDaMensagem(id);
      if (!vinculo) return res.status(404).json({ erro: 'Arquivo não encontrado ou expirado.' });
      const quem = autenticarReq(req, res, vinculo.apto);
      if (!quem) return;
      const arq = await persist.obterMidia(id);
      if (!arq) return res.status(404).json({ erro: 'Arquivo não encontrado ou expirado.' });
      const nome = arq.nome || 'arquivo';
      const mime = mimeEfetivo(arq.mime, nome);
      const inline = mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/') || mime === 'application/pdf';
      const dados = arq.dados || Buffer.alloc(0);
      const total = dados.length;
      const cab = {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${nome.replace(/"/g, '')}"`,
        'Cache-Control': 'private, max-age=3600'
      };
      // Range (necessário para streaming de vídeo no navegador/Safari e players nativos)
      const rm = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
      if (rm && total > 0 && (rm[1] !== '' || rm[2] !== '')) {
        let ini, fim;
        if (rm[1] === '') { // últimos N bytes
          ini = Math.max(0, total - parseInt(rm[2], 10));
          fim = total - 1;
        } else {
          ini = parseInt(rm[1], 10);
          fim = rm[2] === '' ? total - 1 : Math.min(parseInt(rm[2], 10), total - 1);
        }
        if (ini >= total || ini > fim) {
          res.status(416).set({ ...cab, 'Content-Range': `bytes */${total}` });
          return res.end();
        }
        res.status(206).set({
          ...cab,
          'Content-Range': `bytes ${ini}-${fim}/${total}`,
          'Content-Length': fim - ini + 1
        });
        return res.end(dados.subarray(ini, fim + 1));
      }
      res.set({ ...cab, 'Content-Length': total });
      res.end(dados);
    } catch (e) {
      console.error(e);
      res.status(500).json({ erro: 'Falha ao baixar o arquivo.' });
    }
  });


  app.post('/api/portaria/limpeza', async (req, res) => {
    if (!exigirSenhaPortaria(req, res)) return;
    try {
      const body = req.body || {};
      const nomes = new Set((body.nomes || []).map(n => String(n).trim()).filter(Boolean));
      const telefones = new Set((body.telefones || []).map(t => String(t).replace(/\D/g, '')).filter(Boolean));
      const usuarioIds = new Set((body.usuarioIds || []).map(String).filter(Boolean));
      const aptosMsg = (body.aptosRecados || []).map(a => normalizarUnidade(a)).filter(Boolean);
      const mensagemIds = (body.mensagemIds || []).map(String).filter(Boolean);

      const antes = (db.usuarios || []).length;
      db.usuarios = (db.usuarios || []).filter(u => {
        const tel = String(u.telefone || '').replace(/\D/g, '');
        const bate = (usuarioIds.size && usuarioIds.has(u.id))
          || (nomes.size && nomes.has(String(u.nome || '').trim()))
          || (telefones.size && telefones.has(tel));
        return !bate;
      });
      const usuariosRemovidos = antes - db.usuarios.length;
      if (usuariosRemovidos) {
        const { salvar } = require('./store');
        salvar();
      }

      let recados = { mensagens: 0, midias: 0 };
      if (aptosMsg.length || mensagemIds.length) {
        recados = await persist.apagarMensagens({ ids: mensagemIds, aptos: aptosMsg });
      }
      if (ctx.difundirNaoLidas) ctx.difundirNaoLidas().catch(() => {});
      res.json({ ok: true, usuariosRemovidos, recados });
    } catch (e) {
      console.error(e);
      res.status(500).json({ erro: 'Falha ao limpar dados de teste.' });
    }
  });
};

module.exports.mimeEfetivo = mimeEfetivo;
