import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, "frete.db");
sqlite3.verbose();
export const db = new sqlite3.Database(dbPath);

// cria tabelas
db.serialize(() => {
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
});

export function all(sql, params = []) {
  return new Promise((res, rej) => {
    db.all(sql, params, (err, rows) => (err ? rej(err) : res(rows)));
  });
}

export function run(sql, params = []) {
  return new Promise((res, rej) => {
    db.run(sql, params, function (err) {
      if (err) rej(err);
      else res({ id: this.lastID, changes: this.changes });
    });
  });
}
