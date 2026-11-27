// Helpers compartilhados: rótulo e agrupamento das 182 unidades (lojas + apartamentos).
(function (g) {
  function ehLoja(apto) {
    return /^LJ\s*[A-D]$/i.test(String(apto || '').trim());
  }
  function rotuloUnidade(apto) {
    const id = String(apto || '').trim();
    if (ehLoja(id)) {
      const m = id.match(/^LJ\s*([A-D])$/i);
      return m ? 'LJ ' + m[1].toUpperCase() : id;
    }
    return 'Apto ' + id;
  }
  function chaveGrupo(apto) {
    if (ehLoja(apto)) return 'lojas';
    const m = String(apto).match(/(\d{3,})/);
    const n = m ? parseInt(m[1], 10) : 0;
    return n >= 100 ? String(Math.floor(n / 100)) : '0';
  }
  function rotuloGrupo(chave) {
    if (chave === 'lojas') return 'Lojas';
    const n = Number(chave);
    return n ? n + 'º andar' : 'Outros';
  }
  // Horário de Brasília (America/Sao_Paulo, UTC−3 o ano inteiro desde 2019).
  function formatarDataHoraSP(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }
  function corresponde(apto, q) {
    if (!q) return true;
    return String(apto).toLowerCase().includes(String(q).trim().toLowerCase());
  }
  function opcoesAgrupadas(lista, esc) {
    const grupos = [];
    const map = new Map();
    for (const a of lista) {
      const k = chaveGrupo(a.apto);
      if (!map.has(k)) { map.set(k, []); grupos.push(k); }
      map.get(k).push(a);
    }
    if (!grupos.length) return '<option value="">Nenhuma unidade encontrada</option>';
    return grupos.map(k => {
      const itens = map.get(k).map(a => {
        const extra = a.bloco ? ' · Bloco ' + a.bloco : '';
        return `<option value="${esc(a.apto)}">${esc(rotuloUnidade(a.apto) + extra)}</option>`;
      }).join('');
      return `<optgroup label="${esc(rotuloGrupo(k))}">${itens}</optgroup>`;
    }).join('');
  }
  g.Unidades = { ehLoja, rotuloUnidade, chaveGrupo, rotuloGrupo, formatarDataHoraSP, corresponde, opcoesAgrupadas };
})(window);
