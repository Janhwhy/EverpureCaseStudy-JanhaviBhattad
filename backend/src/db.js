import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DuckDBInstance } from '@duckdb/node-api';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SQL_DIR = path.join(ROOT, 'sql');
const CSV_PATH = path.join(ROOT, 'data', 'pure_insights_monitoring.csv');

// DATA_SOURCE=snowflake runs everything on a real Snowflake account; the default is an
// in-memory DuckDB so the project runs with no account. Files 01..04 are the same for both.
export const DATA_SOURCE = process.env.DATA_SOURCE === 'snowflake' ? 'snowflake' : 'duckdb';

let engine;

export async function initDb({ csvPath = CSV_PATH } = {}) {
  engine = DATA_SOURCE === 'snowflake' ? await snowflakeEngine() : await duckdbEngine();

  const shared = (await readdir(SQL_DIR)).filter((f) => /^0[1-9]_.*\.sql$/.test(f)).sort();
  const loader = DATA_SOURCE === 'snowflake' ? 'snowflake/00_load_snowflake.sql' : '00_load_duckdb.sql';
  for (const file of [loader, ...shared]) {
    const sql = await readFile(path.join(SQL_DIR, file), 'utf8');
    await engine.runScript(sql.replaceAll('{{csv_path}}', csvPath.replaceAll("'", "''")));
  }
}

export const query = (sql, params = []) => engine.query(sql, params);

// ---- DuckDB ------------------------------------------------------------------------------

async function duckdbEngine() {
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  // BigInt (COUNT, SUM of integers) is not JSON-serialisable; every value here fits in a Number.
  const toJson = (row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]));
  return {
    runScript: (sql) => connection.run(sql),
    query: async (sql, params) => (await connection.runAndReadAll(sql, params)).getRowObjectsJS().map(toJson),
  };
}

// ---- Snowflake ---------------------------------------------------------------------------

async function snowflakeEngine() {
  const { default: snowflake } = await import('snowflake-sdk');
  snowflake.configure({ logLevel: 'ERROR' });

  const env = (name) => {
    if (!process.env[name]) throw new Error(`DATA_SOURCE=snowflake needs ${name} (see backend/.env.example)`);
    return process.env[name];
  };
  // Key-pair auth for a SERVICE user: no password is stored anywhere.
  const connection = snowflake.createConnection({
    account: env('SNOWFLAKE_ACCOUNT'),
    username: env('SNOWFLAKE_USER'),
    authenticator: 'SNOWFLAKE_JWT',
    privateKeyPath: path.resolve(ROOT, env('SNOWFLAKE_PRIVATE_KEY_PATH')),
    role: process.env.SNOWFLAKE_ROLE ?? 'PI_APP',
    warehouse: process.env.SNOWFLAKE_WAREHOUSE ?? 'PI_WH',
    database: process.env.SNOWFLAKE_DATABASE ?? 'PURE_INSIGHTS',
    schema: 'PUBLIC',
    application: 'pure-insights-command-centre',
  });
  await new Promise((resolve, reject) => connection.connect((err) => (err ? reject(err) : resolve())));

  const execute = (sqlText, binds = []) =>
    new Promise((resolve, reject) => {
      connection.execute({ sqlText, binds, complete: (err, _stmt, rows) => (err ? reject(err) : resolve(rows ?? [])) });
    });

  // Snowflake returns unquoted identifiers in upper case; the API speaks lower case.
  const lowerKeys = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]));

  return {
    // The driver runs one statement per call: drop comment lines, split on statement-ending semicolons.
    async runScript(sql) {
      const statements = sql
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .split(/;\s*(?:\n|$)/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const statement of statements) await execute(statement);
    },
    // Queries are written with DuckDB-style $1 placeholders; Snowflake numbers them :1.
    query: async (sql, params) => (await execute(sql.replace(/\$(\d+)/g, ':$1'), params)).map(lowerKeys),
  };
}
