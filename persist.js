// Persistência em Postgres (DATABASE_URL). Sem a URL, cadastros e
// mensagens ficam só em memória/data.json — no plano free do Render isso
// some quando o serviço dorme ou reinicia.
const crypto = require('crypto');

const MAX_MIDIA = 10 * 1024 * 1024; // 10 MB por arquivo
const DIAS_MIDIA = 30;

let pool = null;
const memMsg = [];
const memMidia = new Map();

function ativo() { return !!pool; }

function uid() { return crypto.randomBytes(12).toString('hex'); }

async function iniciar(db) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('Sem DATABASE_URL: cadastros e mensagens só em data.json (somem no reinício do plano free).');
    return false;
  }
  const { Pool } = require('pg');
  const precisaSsl = !/localhost|127\.0\.0\.1/.test(url) && process.env.PGSSL !== '0';
  pool = new Pool({
    connectionString: url,
    max: 4,
    ssl: precisaSsl ? { rejectUnauthorized: false } : false
  });
  await pool.query('SELECT 1');
  await criarTabelas();
  await carregarEstado(db);
  console.log('Postgres conectado: cadastros, histórico e mensagens persistem (limite ~1 GB no plano free).');
  limparMidiasAntigas().catch(e => console.error('limpeza de mídias:', e.message));
  setInterval(() => limparMidiasAntigas().catch(e => console.error('limpeza de mídias:', e.message)), 60 * 60 * 1000);
  return true;
}

async function criarTabelas() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS estado (
      chave TEXT PRIMARY KEY,
      valor JSONB NOT NULL,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS mensagens (
      id TEXT PRIMARY KEY,
      apto TEXT NOT NULL,
      de_tipo TEXT NOT NULL,
      de_nome TEXT,
      de_user_id TEXT,
      texto TEXT,
      midia_id TEXT,
      midia_tipo TEXT,
      midia_nome TEXT,
      midia_mime TEXT,
      midia_bytes INTEGER,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      lida_por_portaria BOOLEAN NOT NULL DEFAULT false,
      lida_por_morador BOOLEAN NOT NULL DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS mensagens_apto_em ON mensagens (apto, criado_em);
    CREATE TABLE IF NOT EXISTS midias (
      id TEXT PRIMARY KEY,
      mime TEXT,
      nome TEXT,
      dados BYTEA NOT NULL,
      bytes INTEGER NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function carregarEstado(db) {
  const r = await pool.query('SELECT chave, valor FROM estado');
  const map = Object.fromEntries(r.rows.map(x => [x.chave, x.valor]));
  if (Array.isArray(map.usuarios)) db.usuarios = map.usuarios;
  if (Array.isArray(map.historico)) db.historico = map.historico;
  if (Array.isArray(map.avisos)) db.avisos = map.avisos;
  if (map.config && typeof map.config === 'object' && Object.prototype.hasOwnProperty.call(map.config, 'portariaTelefone')) {
    db.portariaTelefone = map.config.portariaTelefone;
  }
  console.log(`Estado restaurado do Postgres: ${ (db.usuarios || []).length } cadastros, ${ (db.historico || []).length } ligações.`);
}

async function salvarEstado(db) {
  if (!pool) return;
  const pares = [
    ['usuarios', db.usuarios || []],
    ['historico', db.historico || []],
    ['avisos', db.avisos || []],
    ['config', { portariaTelefone: db.portariaTelefone }]
  ];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [chave, valor] of pares) {
      await client.query(
        `INSERT INTO estado (chave, valor, atualizado_em) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`,
        [chave, JSON.stringify(valor)]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

function metaDeRow(r) {
  return {
    id: r.id,
    apto: r.apto,
    de: { tipo: r.de_tipo, nome: r.de_nome, userId: r.de_user_id || null },
    texto: r.texto || '',
    midia: r.midia_id ? {
      id: r.midia_id,
      tipo: r.midia_tipo,
      nome: r.midia_nome,
      mime: r.midia_mime,
      bytes: r.midia_bytes
    } : null,
    em: (r.criado_em instanceof Date ? r.criado_em.toISOString() : r.criado_em),
    lidaPorPortaria: !!r.lida_por_portaria,
    lidaPorMorador: !!r.lida_por_morador
  };
}

async function comprimirFoto(buf, mime) {
  if (!mime || !String(mime).startsWith('image/') || String(mime) === 'image/gif') return { buf, mime };
  try {
    const sharp = require('sharp');
    const out = await sharp(buf)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75, mozjpeg: true })
      .toBuffer();
    return { buf: out, mime: 'image/jpeg' };
  } catch (e) {
    console.warn('compressão de foto indisponível:', e.message);
    return { buf, mime };
  }
}

async function gravarMidia({ buffer, mime, nome, tipo }) {
  if (!buffer || !buffer.length) throw Object.assign(new Error('Arquivo vazio.'), { codigo: 400 });
  let dados = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let tipoMime = mime || 'application/octet-stream';
  if (tipo === 'foto' || (tipoMime && tipoMime.startsWith('image/'))) {
    const c = await comprimirFoto(dados, tipoMime);
    dados = c.buf;
    tipoMime = c.mime;
  }
  if (dados.length > MAX_MIDIA) {
    throw Object.assign(new Error('Arquivo maior que 10 MB.'), { codigo: 413 });
  }
  const id = uid();
  const agora = new Date();
  if (pool) {
    await pool.query(
      'INSERT INTO midias (id, mime, nome, dados, bytes, criado_em) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, tipoMime, nome || 'arquivo', dados, dados.length, agora]
    );
  } else {
    memMidia.set(id, { id, mime: tipoMime, nome: nome || 'arquivo', dados, bytes: dados.length, criado_em: agora });
  }
  return { id, mime: tipoMime, nome: nome || 'arquivo', bytes: dados.length };
}

async function obterMidia(id) {
  if (pool) {
    const r = await pool.query('SELECT id, mime, nome, dados, bytes, criado_em FROM midias WHERE id = $1', [id]);
    return r.rows[0] || null;
  }
  return memMidia.get(id) || null;
}

async function criarMensagem({ apto, deTipo, deNome, deUserId, texto, midia }) {
  const id = uid();
  const agora = new Date();
  const row = {
    id,
    apto,
    de_tipo: deTipo,
    de_nome: deNome || (deTipo === 'portaria' ? 'Portaria' : 'Morador'),
    de_user_id: deUserId || null,
    texto: texto ? String(texto).slice(0, 4000) : '',
    midia_id: midia ? midia.id : null,
    midia_tipo: midia ? midia.tipo : null,
    midia_nome: midia ? midia.nome : null,
    midia_mime: midia ? midia.mime : null,
    midia_bytes: midia ? midia.bytes : null,
    criado_em: agora,
    lida_por_portaria: deTipo === 'portaria',
    lida_por_morador: deTipo === 'morador'
  };
  if (pool) {
    await pool.query(
      `INSERT INTO mensagens (
         id, apto, de_tipo, de_nome, de_user_id, texto,
         midia_id, midia_tipo, midia_nome, midia_mime, midia_bytes,
         criado_em, lida_por_portaria, lida_por_morador
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [row.id, row.apto, row.de_tipo, row.de_nome, row.de_user_id, row.texto,
       row.midia_id, row.midia_tipo, row.midia_nome, row.midia_mime, row.midia_bytes,
       row.criado_em, row.lida_por_portaria, row.lida_por_morador]
    );
  } else {
    memMsg.push(row);
    if (memMsg.length > 5000) memMsg.shift();
  }
  return metaDeRow(row);
}

async function listarMensagens(apto, { depois, limite } = {}) {
  const lim = Math.min(200, Math.max(1, Number(limite) || 100));
  if (pool) {
    const params = [apto];
    let sql = 'SELECT * FROM mensagens WHERE apto = $1';
    if (depois) { params.push(depois); sql += ` AND criado_em > $2`; }
    sql += ' ORDER BY criado_em ASC LIMIT ' + lim;
    const r = await pool.query(sql, params);
    return r.rows.map(metaDeRow);
  }
  return memMsg.filter(m => m.apto === apto && (!depois || m.criado_em > new Date(depois))).slice(-lim).map(metaDeRow);
}

async function marcarLidas(apto, quem) {
  if (quem === 'portaria') {
    if (pool) await pool.query('UPDATE mensagens SET lida_por_portaria = true WHERE apto = $1 AND lida_por_portaria = false', [apto]);
    else memMsg.filter(m => m.apto === apto).forEach(m => { m.lida_por_portaria = true; });
  } else {
    if (pool) await pool.query('UPDATE mensagens SET lida_por_morador = true WHERE apto = $1 AND lida_por_morador = false', [apto]);
    else memMsg.filter(m => m.apto === apto).forEach(m => { m.lida_por_morador = true; });
  }
}

async function conversas() {
  if (pool) {
    const r = await pool.query(`
      SELECT DISTINCT ON (apto) *
      FROM mensagens
      ORDER BY apto, criado_em DESC
    `);
    const n = await pool.query(`
      SELECT apto, count(*)::int AS n
      FROM mensagens
      WHERE lida_por_portaria = false AND de_tipo = 'morador'
      GROUP BY apto
    `);
    const unread = Object.fromEntries(n.rows.map(x => [x.apto, x.n]));
    return r.rows
      .map(row => ({ apto: row.apto, ultima: metaDeRow(row), naoLidas: unread[row.apto] || 0 }))
      .sort((a, b) => String(b.ultima.em).localeCompare(String(a.ultima.em)));
  }
  const por = new Map();
  for (const m of memMsg) por.set(m.apto, m);
  return [...por.values()]
    .map(m => ({
      apto: m.apto,
      ultima: metaDeRow(m),
      naoLidas: memMsg.filter(x => x.apto === m.apto && !x.lida_por_portaria && x.de_tipo === 'morador').length
    }))
    .sort((a, b) => String(b.ultima.em).localeCompare(String(a.ultima.em)));
}

async function naoLidas({ apto, quem } = {}) {
  if (quem === 'portaria') {
    if (pool) {
      const r = await pool.query(
        `SELECT apto, count(*)::int AS n FROM mensagens
         WHERE lida_por_portaria = false AND de_tipo = 'morador'
         GROUP BY apto`
      );
      const porApto = Object.fromEntries(r.rows.map(x => [x.apto, x.n]));
      const total = r.rows.reduce((s, x) => s + x.n, 0);
      return { total, porApto };
    }
    const porApto = {};
    for (const m of memMsg) {
      if (!m.lida_por_portaria && m.de_tipo === 'morador') porApto[m.apto] = (porApto[m.apto] || 0) + 1;
    }
    return { total: Object.values(porApto).reduce((s, n) => s + n, 0), porApto };
  }
  if (!apto) return { total: 0, porApto: {} };
  if (pool) {
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM mensagens
       WHERE apto = $1 AND lida_por_morador = false AND de_tipo = 'portaria'`,
      [apto]
    );
    return { total: r.rows[0].n, porApto: { [apto]: r.rows[0].n } };
  }
  const n = memMsg.filter(m => m.apto === apto && !m.lida_por_morador && m.de_tipo === 'portaria').length;
  return { total: n, porApto: { [apto]: n } };
}

async function midiaDaMensagem(midiaId) {
  if (pool) {
    const r = await pool.query('SELECT apto, midia_id FROM mensagens WHERE midia_id = $1 LIMIT 1', [midiaId]);
    return r.rows[0] || null;
  }
  return memMsg.find(m => m.midia_id === midiaId) || null;
}

async function limparMidiasAntigas() {
  const corte = new Date(Date.now() - DIAS_MIDIA * 24 * 60 * 60 * 1000);
  if (pool) {
    const del = await pool.query('DELETE FROM midias WHERE criado_em < $1 RETURNING id', [corte]);
    if (del.rowCount) {
      const ids = del.rows.map(r => r.id);
      await pool.query(
        `UPDATE mensagens
         SET midia_id = NULL, midia_tipo = midia_tipo, texto = CASE
           WHEN texto IS NULL OR texto = '' THEN '[mídia expirada]'
           ELSE texto
         END
         WHERE midia_id = ANY($1::text[])`,
        [ids]
      );
      console.log(`Limpeza: ${del.rowCount} mídias com mais de ${DIAS_MIDIA} dias removidas.`);
    }
    return;
  }
  let n = 0;
  for (const [id, m] of [...memMidia.entries()]) {
    if (m.criado_em < corte) { memMidia.delete(id); n++; }
  }
  if (n) console.log(`Limpeza (memória): ${n} mídias antigas removidas.`);
}


async function apagarMidias(ids) {
  const lista = [...new Set((ids || []).filter(Boolean))];
  if (!lista.length) return 0;
  if (pool) {
    const r = await pool.query('DELETE FROM midias WHERE id = ANY($1::text[])', [lista]);
    return r.rowCount || 0;
  }
  let n = 0;
  for (const id of lista) { if (memMidia.delete(id)) n++; }
  return n;
}

async function apagarMensagens({ ids, aptos }) {
  const idSet = new Set((ids || []).filter(Boolean));
  const aptoSet = new Set((aptos || []).filter(Boolean));
  let midiaIds = [];
  let n = 0;
  if (pool) {
    const conds = [];
    const params = [];
    if (idSet.size) { params.push([...idSet]); conds.push('id = ANY($' + params.length + '::text[])'); }
    if (aptoSet.size) { params.push([...aptoSet]); conds.push('apto = ANY($' + params.length + '::text[])'); }
    if (!conds.length) return { mensagens: 0, midias: 0 };
    const sel = await pool.query('SELECT id, midia_id FROM mensagens WHERE ' + conds.join(' OR '), params);
    midiaIds = sel.rows.map(r => r.midia_id).filter(Boolean);
    const del = await pool.query('DELETE FROM mensagens WHERE ' + conds.join(' OR '), params);
    n = del.rowCount || 0;
  } else {
    const keep = [];
    for (const m of memMsg) {
      if (idSet.has(m.id) || aptoSet.has(m.apto)) {
        n++;
        if (m.midia_id) midiaIds.push(m.midia_id);
      } else keep.push(m);
    }
    memMsg.length = 0;
    memMsg.push(...keep);
  }
  const midias = await apagarMidias(midiaIds);
  return { mensagens: n, midias };
}

module.exports = {

  MAX_MIDIA, DIAS_MIDIA,
  iniciar, ativo, salvarEstado,
  gravarMidia, obterMidia, midiaDaMensagem,
  criarMensagem, listarMensagens, marcarLidas, conversas, naoLidas,
  limparMidiasAntigas
};
