import express from "express";
import multer from "multer";
import { all, run } from "./db.js";
import { parseReport } from "./parseHtml.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /api/import  (upload de 1..N .html)
router.post("/import", upload.array("files", 20), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: "Nenhum arquivo enviado" });

    const inseridos = [];
    for (const f of req.files) {
      const txt = f.buffer.toString("utf8");
      const data = parseReport(txt);
      if (!data.placa) continue;

      const { id } = await run(
        `INSERT INTO trips (placa, dispositivo, kmPercurso, inicio, fim, odometro)
         VALUES (?,?,?,?,?,?)`,
        [data.placa, data.dispositivo, data.kmPercurso, data.inicio, data.fim, data.odometro]
      );
      inseridos.push({ id, ...data });
    }

    // placas únicas desse lote
    const placasDoLote = [...new Set(inseridos.map(x => x.placa))];

    res.json({ ok: true, count: inseridos.length, placasDoLote, inseridos });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Falha ao importar" });
  }
});

// GET /api/plates
router.get("/plates", async (_req, res) => {
  const rows = await all(`SELECT DISTINCT placa FROM trips ORDER BY placa ASC`);
  res.json(rows.map(r => r.placa));
});

// GET /api/trips?placa=XXX
router.get("/trips", async (req, res) => {
  const { placa } = req.query;
  if (!placa) {
    const rows = await all(`SELECT * FROM trips ORDER BY created_at ASC, id ASC`);
    // anexa número da viagem por placa
    const map = {};
    rows.forEach(r => {
      map[r.placa] = map[r.placa] || 0;
      map[r.placa]++;
      r.numero = map[r.placa];
    });
    return res.json(rows);
  }
  const rows = await all(`SELECT * FROM trips WHERE placa = ? ORDER BY created_at ASC, id ASC`, [placa]);
  rows.forEach((r, i) => r.numero = i + 1);
  res.json(rows);
});

// GET /api/summary
router.get("/summary", async (_req, res) => {
  const rows = await all(`SELECT placa, kmPercurso FROM trips`);
  const placas = new Set(rows.map(r => r.placa));
  const totalKm = rows.reduce((s, r) => s + (r.kmPercurso || 0), 0);
  res.json({ totalPlacas: placas.size, totalKm: Number(totalKm.toFixed(2)) });
});

// DELETE /api/trips/:id
router.delete("/trips/:id", async (req, res) => {
  const { id } = req.params;
  const result = await run(`DELETE FROM trips WHERE id = ?`, [id]);
  res.json({ ok: result.changes > 0 });
});

// DELETE /api/all
router.delete("/all", async (_req, res) => {
  await run(`DELETE FROM trips`, []);
  res.json({ ok: true });
});

// Cadastrar/atualizar valor por km de uma placa
// POST /api/rate  body: { placa: "PTH-4J51", valor_km: 5.10 }
router.post("/rate", async (req, res) => {
  const { placa, valor_km } = req.body || {};
  if (!placa || valor_km == null) {
    return res.status(400).json({ error: "placa e valor_km são obrigatórios" });
  }

  await run(`
    INSERT INTO rates (placa, valor_km)
    VALUES (?, ?)
    ON CONFLICT(placa) DO UPDATE SET valor_km = excluded.valor_km
  `, [placa, Number(valor_km)]);

  res.json({ ok: true });
});

// Pré-visualizar fechamento por período (não grava)
// GET /api/fechamento?inicio=2025-10-01&fim=2025-10-10
router.get("/fechamento", async (req, res) => {
  const { inicio, fim } = req.query;
  if (!inicio || !fim) return res.status(400).json({ error: "inicio e fim são obrigatórios (YYYY-MM-DD)" });

  const rows = await all(`
    SELECT placa, SUM(kmPercurso) as km_total
    FROM trips
    WHERE date(inicio) >= date(?) AND date(fim) <= date(?)
    GROUP BY placa
  `, [inicio, fim]);

  const resultFinal = [];
  for (const r of rows) {
    const rate = await all(`SELECT valor_km FROM rates WHERE placa = ?`, [r.placa]);
    const valor_km = rate[0]?.valor_km ?? 0;
    const km_total = Number(r.km_total || 0);
    resultFinal.push({
      placa: r.placa,
      km_total,
      valor_km,
      total_pagar: Number((km_total * valor_km).toFixed(2))
    });
  }

  const soma_geral = resultFinal.reduce((s, x) => s + x.total_pagar, 0);
  res.json({ periodo: { inicio, fim }, dados: resultFinal, soma_geral: Number(soma_geral.toFixed(2)) });
});

// Fechar e gravar no histórico (assina a dezena)
// POST /api/fechamento/finalizar  body: { inicio: "2025-10-01", fim: "2025-10-10" }
router.post("/fechamento/finalizar", async (req, res) => {
  const { inicio, fim } = req.body || {};
  if (!inicio || !fim) return res.status(400).json({ error: "inicio e fim são obrigatórios" });

  const rows = await all(`
    SELECT placa, SUM(kmPercurso) as km_total
    FROM trips
    WHERE date(inicio) >= date(?) AND date(fim) <= date(?)
    GROUP BY placa
  `, [inicio, fim]);

  const inseridos = [];
  for (const r of rows) {
    const rate = await all(`SELECT valor_km FROM rates WHERE placa = ?`, [r.placa]);
    const valor_km = rate[0]?.valor_km ?? 0;
    const km_total = Number(r.km_total || 0);
    const total_pagar = Number((km_total * valor_km).toFixed(2));

    const { id } = await run(`
      INSERT INTO settlements (placa, periodo_inicio, periodo_fim, km_total, valor_km, total_pagar)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [r.placa, inicio, fim, km_total, valor_km, total_pagar]);

    inseridos.push({ id, placa: r.placa, km_total, valor_km, total_pagar });
  }

  res.json({ ok: true, periodo: { inicio, fim }, inseridos });
});

// ===================== FRETE / RATES / FECHAMENTO =====================

// POST /api/rate  -> cadastra/atualiza o valor por km de uma placa
// body: { placa: "PTH-4J51", valor_km: 5.10 }
router.post("/rate", async (req, res) => {
  try {
    const { placa, valor_km } = req.body || {};
    if (!placa || valor_km == null) {
      return res.status(400).json({ error: "placa e valor_km são obrigatórios" });
    }
    await run(`
      INSERT INTO rates (placa, valor_km)
      VALUES (?, ?)
      ON CONFLICT(placa) DO UPDATE SET valor_km = excluded.valor_km
    `, [placa.trim().toUpperCase(), Number(valor_km)]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Falha ao salvar rate" });
  }
});

// GET /api/rates  -> lista todas as placas com seus valores por km
router.get("/rates", async (_req, res) => {
  const rows = await all(`SELECT placa, valor_km FROM rates ORDER BY placa ASC`);
  res.json(rows);
});

// GET /api/fechamento?inicio=YYYY-MM-DD&fim=YYYY-MM-DD  (prévia, não grava)
router.get("/fechamento", async (req, res) => {
  const { inicio, fim } = req.query;
  if (!inicio || !fim) {
    return res.status(400).json({ error: "inicio e fim são obrigatórios (YYYY-MM-DD)" });
  }

  // soma km por placa no período
  const rows = await all(`
    SELECT placa, SUM(kmPercurso) as km_total
    FROM trips
    WHERE date(inicio) >= date(?) AND date(fim) <= date(?)
    GROUP BY placa
  `, [inicio, fim]);

  const dados = [];
  for (const r of rows) {
    const km_total = Number(r.km_total || 0);
    const rate = await all(`SELECT valor_km FROM rates WHERE placa = ?`, [r.placa]);
    const valor_km = rate[0]?.valor_km ?? 0;
    const total_pagar = Number((km_total * valor_km).toFixed(2));
    dados.push({ placa: r.placa, km_total, valor_km, total_pagar });
  }

  const soma_geral = Number(dados.reduce((s, x) => s + x.total_pagar, 0).toFixed(2));
  res.json({ periodo: { inicio, fim }, dados, soma_geral });
});

// POST /api/fechamento/finalizar  (grava no histórico)
router.post("/fechamento/finalizar", async (req, res) => {
  const { inicio, fim } = req.body || {};
  if (!inicio || !fim) {
    return res.status(400).json({ error: "inicio e fim são obrigatórios (YYYY-MM-DD)" });
  }

  const rows = await all(`
    SELECT placa, SUM(kmPercurso) as km_total
    FROM trips
    WHERE date(inicio) >= date(?) AND date(fim) <= date(?)
    GROUP BY placa
  `, [inicio, fim]);

  const inseridos = [];
  for (const r of rows) {
    const km_total = Number(r.km_total || 0);
    const rate = await all(`SELECT valor_km FROM rates WHERE placa = ?`, [r.placa]);
    const valor_km = rate[0]?.valor_km ?? 0;
    const total_pagar = Number((km_total * valor_km).toFixed(2));

    const { id } = await run(`
      INSERT INTO settlements (placa, periodo_inicio, periodo_fim, km_total, valor_km, total_pagar)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [r.placa, inicio, fim, km_total, valor_km, total_pagar]);

    inseridos.push({ id, placa: r.placa, km_total, valor_km, total_pagar });
  }

  res.json({ ok: true, periodo: { inicio, fim }, inseridos });
});



export default router;
