// ÚNICA FONTE DOS APARTAMENTOS DO CONDOMÍNIO. Para trocar a lista, edite só APTOS_POR_ANDAR.
// Não há blocos: só o número do apto (agrupado por andar nas telas).
// Formas aceitas por andar: lista explícita de números, ou { de: 101, ate: 136 } (intervalo).
const APTOS_POR_ANDAR = {
  1: { de: 101, ate: 136 },
  2: { de: 201, ate: 236 },
  3: { de: 301, ate: 336 },
  4: { de: 401, ate: 436 },
  5: { de: 501, ate: 536 }
  // 36 aptos por andar, 180 no total.
};

function expandir(def) {
  if (Array.isArray(def)) return def.map(String);
  const r = [];
  for (let n = def.de; n <= def.ate; n++) r.push(String(n));
  return r;
}

const apartamentos = [];
for (const andar of Object.keys(APTOS_POR_ANDAR).sort((a, b) => a - b)) {
  for (const apto of expandir(APTOS_POR_ANDAR[andar])) apartamentos.push({ apto });
}

// Cadastros começam vazios: cada morador/proprietário se registra pelo app.
module.exports = { apartamentos, usuarios: [] };
