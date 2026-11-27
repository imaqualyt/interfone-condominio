// ÚNICA FONTE DAS UNIDADES DO CONDOMÍNIO (lista explícita do balanço, não intervalo gerado).
// 175 apartamentos + 4 lojas (LJ A–D) = 179 unidades. Sem blocos; lojas no térreo, depois andares 1–6.
const LOJAS = ['LJ A', 'LJ B', 'LJ C', 'LJ D'];

const APTOS_POR_ANDAR = {
  1: [116, 117, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 139, 140],
  2: [201, 202, 203, 204, 205, 206, 208, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240],
  3: [301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 331, 332, 333, 334, 335, 336, 337, 338, 339, 340],
  4: [401, 402, 403, 404, 405, 406, 407, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418, 419, 420, 421, 422, 423, 424, 425, 426, 427, 428, 429, 430, 431, 432, 433, 434, 435, 436, 437, 438, 439, 440],
  5: [501, 502, 503, 504, 505, 506, 507, 508, 510, 511, 512, 513, 514, 515, 516, 517, 518, 520, 521, 522, 523, 525, 526, 527, 528, 529, 530, 531, 532, 533, 534, 535, 536, 537, 538, 539, 540],
  6: [601]
};

const CONTAGEM_POR_ANDAR = { 1: 21, 2: 37, 3: 40, 4: 39, 5: 37, 6: 1 };

function assert(cond, msg) {
  if (!cond) throw new Error('seed.js: ' + msg);
}

for (const [andar, n] of Object.entries(CONTAGEM_POR_ANDAR)) {
  const lista = APTOS_POR_ANDAR[andar];
  assert(Array.isArray(lista), `andar ${andar} deve ser uma lista explícita`);
  assert(lista.length === n, `andar ${andar}: esperado ${n} aptos, veio ${lista.length}`);
  assert(new Set(lista.map(String)).size === lista.length, `andar ${andar}: números repetidos`);
}

function ehLoja(apto) {
  return /^LJ\s*[A-D]$/i.test(String(apto || '').trim());
}

// 'lj b' / 'LJ  B' → 'LJ B'; apartamentos ficam só com trim ('116').
function normalizarUnidade(s) {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  const m = t.match(/^LJ\s*([A-D])$/i);
  if (m) return 'LJ ' + m[1].toUpperCase();
  return t;
}

const lojas = LOJAS.map(apto => ({ apto, tipo: 'loja' }));
const aptos = [];
for (const andar of Object.keys(APTOS_POR_ANDAR).sort((a, b) => a - b)) {
  for (const n of APTOS_POR_ANDAR[andar]) {
    aptos.push({ apto: String(n), tipo: 'apto', andar: Number(andar) });
  }
}

assert(LOJAS.length === 4, `esperado 4 lojas, veio ${LOJAS.length}`);
assert(aptos.length === 175, `esperado 175 apartamentos, veio ${aptos.length}`);
const apartamentos = [...lojas, ...aptos];
assert(apartamentos.length === 179, `esperado 179 unidades, veio ${apartamentos.length}`);
assert(new Set(apartamentos.map(a => a.apto)).size === 179, 'unidades com id repetido');

// Cadastros começam vazios: cada morador/proprietário se registra pelo app.
module.exports = { apartamentos, usuarios: [], LOJAS, APTOS_POR_ANDAR, ehLoja, normalizarUnidade };
