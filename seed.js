// ÚNICA FONTE DAS UNIDADES DO CONDOMÍNIO (lista explícita, não intervalo gerado).
// 178 unidades de apartamento + 4 lojas (LJ A–D) = 182 unidades.
// Sem blocos; lojas no térreo, depois andares 1–6.
// 536 e 538 foram unidos: um único id '536/538' (busca e cadastro também aceitam 536 ou 538).
const LOJAS = ['LJ A', 'LJ B', 'LJ C', 'LJ D'];

const APTOS_POR_ANDAR = {
  1: [116, 117, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 139, 140],
  2: [201, 202, 203, 204, 205, 206, 208, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240],
  3: [301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322, 323, 324, 325, 326, 327, 328, 329, 330, 331, 332, 333, 334, 335, 336, 337, 338, 339, 340],
  4: [401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 418, 419, 420, 421, 422, 423, 424, 425, 426, 427, 428, 429, 430, 431, 432, 433, 434, 435, 436, 437, 438, 439, 440],
  5: [501, 502, 503, 504, 505, 506, 507, 508, 509, 510, 511, 512, 513, 514, 515, 516, 517, 518, 519, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530, 531, 532, 533, 534, 535, '536/538', 537, 539, 540],
  6: [601]
};

const CONTAGEM_POR_ANDAR = { 1: 21, 2: 37, 3: 40, 4: 40, 5: 39, 6: 1 };
const SOMA_ANDARES = 21 + 37 + 40 + 40 + 39 + 1; // 178

function assert(cond, msg) {
  if (!cond) throw new Error('seed.js: ' + msg);
}

assert(SOMA_ANDARES === 178, `soma das parcelas deveria ser 178, veio ${SOMA_ANDARES}`);
const somaContagens = Object.values(CONTAGEM_POR_ANDAR).reduce((a, b) => a + b, 0);
assert(somaContagens === SOMA_ANDARES, `soma das contagens (${somaContagens}) ≠ parcelas (${SOMA_ANDARES})`);

for (const [andar, n] of Object.entries(CONTAGEM_POR_ANDAR)) {
  const lista = APTOS_POR_ANDAR[andar];
  assert(Array.isArray(lista), `andar ${andar} deve ser uma lista explícita`);
  assert(lista.length === n, `andar ${andar}: esperado ${n} unidades, veio ${lista.length}`);
  assert(new Set(lista.map(String)).size === lista.length, `andar ${andar}: ids repetidos`);
}

function ehLoja(apto) {
  return /^LJ\s*[A-D]$/i.test(String(apto || '').trim());
}

// 'lj b' → 'LJ B'; '536', '538', '536 / 538' → '536/538'; demais ids só com trim.
function normalizarUnidade(s) {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  const loja = t.match(/^LJ\s*([A-D])$/i);
  if (loja) return 'LJ ' + loja[1].toUpperCase();
  const compacto = t.replace(/\s+/g, '');
  if (compacto === '536' || compacto === '538' || compacto === '536/538' || compacto === '538/536') return '536/538';
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
assert(aptos.length === 178, `esperado 178 unidades de apartamento, veio ${aptos.length}`);
assert(!aptos.some(a => a.apto === '536' || a.apto === '538'), '536 e 538 devem existir só como 536/538');
assert(aptos.some(a => a.apto === '536/538'), 'falta a unidade conjunta 536/538');
for (const id of ['408', '509', '519', '524', '536/538', '601']) {
  assert(aptos.some(a => a.apto === id), `falta a unidade ${id}`);
}
const apartamentos = [...lojas, ...aptos];
assert(apartamentos.length === 182, `esperado 182 unidades (178 + 4), veio ${apartamentos.length}`);
assert(somaContagens + LOJAS.length === 182, '178 aptos + 4 lojas deveria ser 182');
assert(new Set(apartamentos.map(a => a.apto)).size === 182, 'unidades com id repetido');
assert(normalizarUnidade('536') === '536/538' && normalizarUnidade('538') === '536/538', '536 e 538 devem mapear para 536/538');

// Cadastros começam vazios: cada morador/proprietário se registra pelo app.
module.exports = { apartamentos, usuarios: [], LOJAS, APTOS_POR_ANDAR, ehLoja, normalizarUnidade };
