import express from "express";
import multer from "multer";
import { all, run } from "./db.js";
import { parseReport } from "./parseHtml.js";
import { createSimplePdf } from "./simplePdf.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ===================== IMPORTAÇÃO DE RELATÓRIOS =====================
router.post("/import", upload.array("files", 20), async (req, res) => {
  try {
    if (!req.files?.length)
      return res.status(400).json({ error: "Nenhum arquivo enviado" });

    const inseridos = [];
    for (const f of req.files) {
      const txt = f.buffer.toString("utf8");
      const data = parseReport(txt);
      if (!data.placa) continue;

      const { id } = await run(
        `INSERT INTO trips (placa, dispositivo, kmPercurso, inicio, fim, odometro)
         VALUES (?,?,?,?,?,?)`,
        [
          data.placa,
          data.dispositivo,
          data.kmPercurso,
          data.inicio,
          data.fim,
          data.odometro,
        ]
      );
      inseridos.push({ id, ...data });
    }

    // placas únicas desse lote
    const placasDoLote = [...new Set(inseridos.map((x) => x.placa))];

    res.json({ ok: true, count: inseridos.length, placasDoLote, inseridos });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Falha ao importar" });
  }
});

// ===================== CONSULTAS BÁSICAS =====================
router.get("/plates", async (_req, res) => {
  const rows = await all(
    `SELECT DISTINCT placa FROM trips ORDER BY placa ASC`
  );
  res.json(rows.map((r) => r.placa));
});

router.get("/trips", async (req, res) => {
  const { placa } = req.query;
  if (!placa) {
    const rows = await all(`SELECT * FROM trips ORDER BY created_at ASC, id ASC`);
    const map = {};
    rows.forEach((r) => {
      map[r.placa] = map[r.placa] || 0;
      map[r.placa]++;
      r.numero = map[r.placa];
    });
    return res.json(rows);
  }

  const rows = await all(
    `SELECT * FROM trips WHERE placa = ? ORDER BY created_at ASC, id ASC`,
    [placa]
  );
  rows.forEach((r, i) => (r.numero = i + 1));
  res.json(rows);
});

router.get("/summary", async (_req, res) => {
  const rows = await all(`SELECT placa, kmPercurso FROM trips`);
  const placas = new Set(rows.map((r) => r.placa));
  const totalKm = rows.reduce((s, r) => s + (r.kmPercurso || 0), 0);
  res.json({ totalPlacas: placas.size, totalKm: Number(totalKm.toFixed(2)) });
});

router.delete("/trips/:id", async (req, res) => {
  const { id } = req.params;
  const result = await run(`DELETE FROM trips WHERE id = ?`, [id]);
  res.json({ ok: result.changes > 0 });
});

router.delete("/all", async (_req, res) => {
  await run(`DELETE FROM trips`, []);
  res.json({ ok: true });
});

// ===================== HELPERS DE DATA (aceita BR e ISO) =====================
const DATE_INICIO_SQL = `
  CASE
    WHEN substr(inicio,3,1)='-' AND substr(inicio,6,1)='-'
      THEN date(substr(inicio,7,4)||'-'||substr(inicio,4,2)||'-'||substr(inicio,1,2))
    ELSE date(inicio)
  END
`;

const DATE_FIM_SQL = `
  CASE
    WHEN substr(fim,3,1)='-' AND substr(fim,6,1)='-'
      THEN date(substr(fim,7,4)||'-'||substr(fim,4,2)||'-'||substr(fim,1,2))
    ELSE date(fim)
  END
`;

function formatNumber(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function formatCurrency(value) {
  return `R$ ${formatNumber(value)}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR");
}

function formatDateColumn(value) {
  const str = formatDateTime(value);
  return (str.length > 19 ? str.slice(0, 19) : str.padEnd(19, " "));
}

function formatKmColumn(value) {
  return formatNumber(value).padStart(8, " ");
}

function formatCurrencyColumn(value) {
  return formatNumber(value).padStart(10, " ");
}

// ===================== FRETE / RATES =====================
router.post("/rate", async (req, res) => {
  try {
    const { placa, valor_km } = req.body || {};
    if (!placa || valor_km == null) {
      return res
        .status(400)
        .json({ error: "placa e valor_km são obrigatórios" });
    }
    await run(
      `
      INSERT INTO rates (placa, valor_km)
      VALUES (?, ?)
      ON CONFLICT(placa) DO UPDATE SET valor_km = excluded.valor_km
    `,
      [placa.trim().toUpperCase(), Number(valor_km)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Falha ao salvar rate" });
  }
});

router.get("/rates", async (_req, res) => {
  const rows = await all(`SELECT placa, valor_km FROM rates ORDER BY placa ASC`);
  res.json(rows);
});

// ===================== FECHAMENTO (PRÉVIA E FINAL) =====================
router.get("/fechamento", async (req, res) => {
  const { inicio, fim } = req.query;
  if (!inicio || !fim)
    return res
      .status(400)
      .json({ error: "inicio e fim são obrigatórios (YYYY-MM-DD)" });

  const rows = await all(
    `
    SELECT placa, SUM(kmPercurso) AS km_total
    FROM trips
    WHERE ${DATE_INICIO_SQL} >= date(?) AND ${DATE_FIM_SQL} <= date(?)
    GROUP BY placa
  `,
    [inicio, fim]
  );

  const dados = [];
  for (const r of rows) {
    const km_total = Number(r.km_total || 0);
    const rate = await all(`SELECT valor_km FROM rates WHERE placa = ?`, [
      r.placa,
    ]);
    const valor_km = rate[0]?.valor_km ?? 0;
    const total_pagar = Number((km_total * valor_km).toFixed(2));
    dados.push({ placa: r.placa, km_total, valor_km, total_pagar });
  }

  const soma_geral = Number(
    dados.reduce((s, x) => s + x.total_pagar, 0).toFixed(2)
  );
  res.json({ periodo: { inicio, fim }, dados, soma_geral });
});

router.post("/fechamento/finalizar", async (req, res) => {
  const { inicio, fim } = req.body || {};
  if (!inicio || !fim)
    return res
      .status(400)
      .json({ error: "inicio e fim são obrigatórios (YYYY-MM-DD)" });

  const rows = await all(
    `
    SELECT placa, SUM(kmPercurso) AS km_total
    FROM trips
    WHERE ${DATE_INICIO_SQL} >= date(?) AND ${DATE_FIM_SQL} <= date(?)
    GROUP BY placa
  `,
    [inicio, fim]
  );

  const inseridos = [];
  for (const r of rows) {
    const km_total = Number(r.km_total || 0);
    const rate = await all(`SELECT valor_km FROM rates WHERE placa = ?`, [
      r.placa,
    ]);
    const valor_km = rate[0]?.valor_km ?? 0;
    const total_pagar = Number((km_total * valor_km).toFixed(2));

    const { id } = await run(
      `
      INSERT INTO settlements (placa, periodo_inicio, periodo_fim, km_total, valor_km, total_pagar)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      [r.placa, inicio, fim, km_total, valor_km, total_pagar]
    );

    inseridos.push({ id, placa: r.placa, km_total, valor_km, total_pagar });
  }

  res.json({ ok: true, periodo: { inicio, fim }, inseridos });
});

router.get("/settlements", async (_req, res) => {
  try {
    const rows = await all(
      `
      SELECT
        periodo_inicio AS inicio,
        periodo_fim AS fim,
        MIN(created_at) AS criado_em,
        COUNT(DISTINCT placa) AS total_placas,
        SUM(km_total) AS km_total,
        SUM(total_pagar) AS total_pagar
      FROM settlements
      GROUP BY periodo_inicio, periodo_fim
      ORDER BY MIN(created_at) DESC
    `
    );

    const normalizado = rows.map((r) => ({
      inicio: r.inicio,
      fim: r.fim,
      criado_em: r.criado_em,
      total_placas: Number(r.total_placas || 0),
      km_total: Number(Number(r.km_total || 0).toFixed(2)),
      total_pagar: Number(Number(r.total_pagar || 0).toFixed(2)),
    }));

    res.json(normalizado);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Falha ao carregar fechamentos" });
  }
});

router.delete("/settlements", async (req, res) => {
  const { inicio, fim } = req.query;
  if (!inicio || !fim) {
    return res
      .status(400)
      .json({ error: "inicio e fim são obrigatórios (YYYY-MM-DD)" });
  }

  try {
    const result = await run(
      `DELETE FROM settlements WHERE periodo_inicio = ? AND periodo_fim = ?`,
      [inicio, fim]
    );

    res.json({ ok: true, removidos: result.changes || 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Falha ao excluir fechamento" });
  }
});

router.get("/settlements/report", async (req, res) => {
  const { inicio, fim } = req.query;
  if (!inicio || !fim) {
    return res
      .status(400)
      .json({ error: "inicio e fim são obrigatórios (YYYY-MM-DD)" });
  }

  try {
    const settlements = await all(
      `
      SELECT placa, km_total, valor_km, total_pagar
      FROM settlements
      WHERE periodo_inicio = ? AND periodo_fim = ?
      ORDER BY placa ASC
    `,
      [inicio, fim]
    );

    if (!settlements.length) {
      return res
        .status(404)
        .json({ error: "Nenhum fechamento encontrado para o período" });
    }
    const linhas = [
      "Relatório de Fechamento de Frete",
      "",
      `Período: ${inicio} a ${fim}`,
      `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
      "",
    ];

    let totalGeral = 0;

    for (const settle of settlements) {
      const { placa, km_total, valor_km, total_pagar } = settle;
      totalGeral += Number(total_pagar || 0);

      linhas.push(`Placa ${placa}`);
      linhas.push(`  Valor do km: ${formatCurrency(valor_km)}`);
      linhas.push(`  KM total no período: ${formatNumber(km_total)} km`);
      linhas.push(`  Total a pagar: ${formatCurrency(total_pagar)}`);
      linhas.push("  Viagens:");
      linhas.push(
        "    Início              Fim                KM       Valor (R$)"
      );
      linhas.push(
        "    -----------------------------------------------------------"
      );

      const trips = await all(
        `
        SELECT placa, kmPercurso, inicio, fim
        FROM trips
        WHERE placa = ?
          AND ${DATE_INICIO_SQL} >= date(?)
          AND ${DATE_FIM_SQL} <= date(?)
        ORDER BY ${DATE_INICIO_SQL} ASC, ${DATE_FIM_SQL} ASC, id ASC
      `,
        [placa, inicio, fim]
      );

      if (!trips.length) {
        linhas.push("    Nenhuma viagem encontrada para este período.");
      } else {
        trips.forEach((trip) => {
          const valorViagem = Number(
            (Number(trip.kmPercurso || 0) * Number(valor_km || 0)).toFixed(2)
          );
          const inicioFmt = formatDateColumn(trip.inicio);
          const fimFmt = formatDateColumn(trip.fim);
          const kmFmt = formatKmColumn(trip.kmPercurso);
          const valorFmt = formatCurrencyColumn(valorViagem);
          linhas.push(`    ${inicioFmt}  ${fimFmt}  ${kmFmt}  ${valorFmt}`);
        });
      }

      linhas.push("");
    }

    linhas.push(`Total geral a pagar: ${formatCurrency(totalGeral)}`);

    const pdf = createSimplePdf(linhas, {
      fontSize: 11,
      leading: 14,
      marginLeft: 40,
      marginTop: 50,
      maxCharsPerLine: 110,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="fechamento-${inicio}-a-${fim}.pdf"`
    );
    res.send(pdf);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) {
      res.status(500).json({ error: "Falha ao gerar relatório" });
    }
  }
});

export default router;
