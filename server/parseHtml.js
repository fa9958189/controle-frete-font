// server/parseHtml.js
export function parseReport(htmlText) {
  const pick = (re) => {
    const m = htmlText.match(re);
    return m ? m[1].trim() : "";
  };

  const toISO = (s) => {
    // DD-MM-YYYY HH:MM:SS  ->  YYYY-MM-DD HH:MM:SS
    const m = s.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}:\d{2}:\d{2})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]} ${m[4]}`;
    return s; // já está em ISO
  };

  const toNumber = (s) => {
    if (!s) return 0;
    // remove texto e espaços
    let t = s.replace(/[^\d.,-]/g, "");
    // se tiver vírgula, trata vírgula como decimal e remove os pontos
    if (t.includes(",")) {
      t = t.replace(/\./g, "").replace(",", ".");
    }
    return parseFloat(t) || 0;
  };

  // Dispositivo: "VW ... // ONS1H25 // LKJ ..."
  const dispositivo = pick(/Dispositivo:<\/th>\s*<td[^>]*>([^<]+)<\/td>/i);
  let placa = dispositivo.split("//")[1] || dispositivo;
  placa = placa.trim().replace(/\s+/g, ""); // tira espaços internos

  const inicioBr = pick(/In[íi]cio da rota:<\/th>\s*<td[^>]*>([^<]+)<\/td>/i);
  const fimBr    = pick(/Final da rota:<\/th>\s*<td[^>]*>([^<]+)<\/td>/i);

  const distanciaTxt = pick(/Dist[âa]ncia do percurso:<\/th>\s*<td[^>]*>([^<]+)<\/td>/i);
  const odometroTxt  = pick(/Od[ôo]metro:<\/th>\s*<td[^>]*>([^<]+)<\/td>/i);

  const data = {
    placa,
    veiculo: dispositivo,
    inicio: toISO(inicioBr),
    fim: toISO(fimBr),
    kmPercurso: toNumber(distanciaTxt),
    odometro: toNumber(odometroTxt),
  };

  // validação mínima
  if (!data.inicio || !data.fim || !data.placa) {
    throw new Error("Relatório incompleto: inicio/fim/placa não detectados.");
  }

  return data;
}
