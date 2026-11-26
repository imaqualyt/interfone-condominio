// Dados de demonstração: apartamentos e (opcionalmente) moradores já cadastrados.
// Os apartamentos 201 e 202 já vêm com moradores que ficam SEMPRE OFFLINE (ninguém logado),
// ótimo para ver o "Apto indisponível". Os aptos 101, 102, 301 e 302 começam vazios.
module.exports = {
  apartamentos: [
    { apto: '101', bloco: 'A' },
    { apto: '102', bloco: 'A' },
    { apto: '201', bloco: 'A' },
    { apto: '202', bloco: 'A' },
    { apto: '301', bloco: 'B' },
    { apto: '302', bloco: 'B' }
  ],
  usuarios: [
    { id: 'seed-201-m', nome: 'Carla Souza', apto: '201', telefone: '21988880201', papel: 'morador' },
    { id: 'seed-201-p', nome: 'Roberto Souza', apto: '201', telefone: '21977770201', papel: 'proprietario' },
    { id: 'seed-202-m', nome: 'Marcos Lima', apto: '202', telefone: '21988880202', papel: 'morador' }
  ]
};
