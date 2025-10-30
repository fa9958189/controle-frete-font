function toNumber(txt = "") {
  const n = String(txt).replace(/\./g, '').replace(',', '.').match(/[\d.]+/g);
  return n ? parseFloat(n.join('')) : 0;
}
function extractPlaca(dispositivoTxt = "") {
  const m = String(dispositivoTxt).toUpperCase().match(/[A-Z0-9]{7}/);
  return m ? m[0] : "";
}

export function parseReport(htmlText) {
  // Parser simples por string (Node não tem DOMParser nativo).
  // Como seu relatório tem th/td previsíveis, buscamos por rótulos.
  const getAfter = (label) => {
    const idx = htmlText.toLowerCase().indexOf(label.toLowerCase());
    if (idx === -1) return "";
    const sub = htmlText.slice(idx, idx + 800); // janela
    // pega conteúdo entre <td> após o <th> que contém o label
    const td = sub.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
    return td ? td[1].replace(/<[^>]+>/g, '').trim() : "";
  };

  const dispositivo = getAfter("Dispositivo");
  const placa = extractPlaca(dispositivo);
  const distanciaTxt = getAfter("Distância do percurso");
  const kmPercurso = toNumber(distanciaTxt);
  const odoTxt = getAfter("Odômetro");
  const odometro = toNumber(odoTxt);
  const inicio = getAfter("Início da rota") || getAfter("Início");
  const fim = getAfter("Final da rota") || getAfter("Final");

  return { placa, dispositivo, kmPercurso, inicio, fim, odometro };
}
