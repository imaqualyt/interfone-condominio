// Armazenamento simples em memória com persistência em arquivo JSON (data/data.json).
const fs = require('fs');
const path = require('path');
const seed = require('./seed');

const FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'data.json');

function blocoDe(apto) {
  const a = seed.apartamentos.find(x => x.apto === String(apto));
  return a ? a.bloco : null;
}

function carregar() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    return {
      usuarios: seed.usuarios.map(u => ({ ...u, bloco: blocoDe(u.apto), criadoEm: new Date().toISOString() })),
      historico: [],
      avisos: []
    };
  }
}

const db = carregar();
let timer = null;
function salvar() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
    } catch (e) { console.error('Falha ao salvar dados:', e.message); }
  }, 100);
}
salvar();

module.exports = { db, salvar, blocoDe, apartamentos: seed.apartamentos, FILE };
