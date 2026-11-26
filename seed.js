// Apartamentos reais do condomínio. Não há blocos: só o número do apto (agrupado por andar).
// Cadastros começam vazios: cada morador/proprietário se registra pelo app.
const apartamentos = [];
for (const andar of [1, 2, 3, 4, 5]) {
  for (const n of [1, 2, 3, 4]) {
    apartamentos.push({ apto: String(andar * 100 + n) });
  }
}

module.exports = {
  apartamentos,
  usuarios: []
};
