const fs = require('fs'); const path = require('path');
const f = path.join(__dirname, '..', 'data', 'data.json');
try { fs.unlinkSync(f); console.log('Dados apagados: voltou ao seed.'); } catch { console.log('Nada para apagar.'); }
