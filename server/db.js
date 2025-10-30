import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, "frete.db");
sqlite3.verbose();
export const db = new sqlite3.Database(dbPath);

// Criação automática das tabelas
db.serialize(() => {
  // VIAGENS (já existia)
  db.run(`
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      placa TEXT NOT NULL,
      dispositivo TEXT,
      kmPercurso REAL DEFAULT 0,
      inicio TEXT,
      fim TEXT,
      odometro REAL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_trips_placa ON trips(placa)`);

  // NOVA: valores por km de cada placa
  db.run(`
    CREATE TABLE IF NOT EXISTS rates (
      placa TEXT PRIMARY KEY,
      valor_km REAL NOT NULL
    )
  `);

  // NOVA: histórico de fechamentos
  db.run(`
    CREATE TABLE IF NOT EXISTS settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      placa TEXT NOT NULL,
      periodo_inicio TEXT NOT NULL,
      periodo_fim TEXT NOT NULL,
      km_total REAL NOT NULL,
      valor_km REAL NOT NULL,
      total_pagar REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
});

export function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

export function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}
