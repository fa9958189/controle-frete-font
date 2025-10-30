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

export default router;
