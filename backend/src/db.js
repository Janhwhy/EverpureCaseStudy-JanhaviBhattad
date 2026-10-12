import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SQL_DIR = path.join(ROOT, 'sql');
const CSV_PATH = path.join(ROOT, 'data', 'pure_insights_monitoring.csv');

let connection;

// Builds an in-memory DuckDB from the CSV by running the same SQL suite that
// would run on Snowflake (sql/00..04, in order).
export async function initDb({ csvPath = CSV_PATH } = {}) {
  const instance = await DuckDBInstance.create(':memory:');
  connection = await instance.connect();

  const files = (await readdir(SQL_DIR)).filter((f) => /^\d\d_.*\.sql$/.test(f)).sort();
  for (const file of files) {
    const sql = await readFile(path.join(SQL_DIR, file), 'utf8');
    await connection.run(sql.replaceAll('{{csv_path}}', csvPath.replaceAll("'", "''")));
  }
}

// BigInt (COUNT, SUM of integers) is not JSON-serialisable; every value here fits in a Number.
const toJson = (row) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]));

export async function query(sql, params = []) {
  const reader = await connection.runAndReadAll(sql, params);
  return reader.getRowObjectsJS().map(toJson);
}
