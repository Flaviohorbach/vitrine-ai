/**
 * The only thing the app needs from a database: run SQL with parameters and
 * get rows back. Postgres + pgvector in both implementations (from project 6):
 *  - production: Neon, serverless Postgres over HTTP;
 *  - local and tests: PGlite, Postgres compiled to WebAssembly, inside Node.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export const EMBEDDING_DIMENSIONS = 768;

/**
 * Every row belongs to a store, and every query filters by store_id. That one
 * rule is the whole multi-tenancy: there is no query that can return another
 * store's products, and the tests check it.
 */
const SCHEMA = [
  "CREATE EXTENSION IF NOT EXISTS vector",
  `CREATE TABLE IF NOT EXISTS stores (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    admin_token_hash TEXT NOT NULL,
    mcp_token_hash TEXT NOT NULL,
    is_demo BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    price_brl NUMERIC(10, 2) NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    image_url TEXT,
    attributes JSONB NOT NULL DEFAULT '{}',
    suggested_description TEXT,
    description_status TEXT NOT NULL DEFAULT 'none',
    search_text TEXT NOT NULL,
    tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('portuguese', search_text)) STORED,
    embedding VECTOR(${EMBEDDING_DIMENSIONS}),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, id)
  )`,
  "CREATE INDEX IF NOT EXISTS products_tsv ON products USING GIN (tsv)",
  `CREATE TABLE IF NOT EXISTS usage (
    store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    day DATE NOT NULL DEFAULT CURRENT_DATE,
    kind TEXT NOT NULL,
    n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (store_id, day, kind)
  )`,
];

export async function migrate(db: Db) {
  for (const statement of SCHEMA) await db.query(statement);
}

/** The Vercel + Neon integration can add a prefix to the variable's name. */
export function findDatabaseUrl(env: Record<string, string | undefined>): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const key = Object.keys(env).sort().find((name) => name.endsWith("_DATABASE_URL") && env[name]);
  return key ? env[key] : undefined;
}

async function createPglite(dataDir?: string): Promise<Db> {
  const [{ PGlite }, { vector }] = await Promise.all([import("@electric-sql/pglite"), import("@electric-sql/pglite-pgvector")]);
  const pg = new PGlite({ dataDir, extensions: { vector } });
  return { query: async (text, params) => (await pg.query(text, params)).rows as never };
}

async function connect(): Promise<Db> {
  const url = findDatabaseUrl(process.env);
  let db: Db;
  if (url) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    db = { query: async (text, params = []) => (await sql.query(text, params)) as never };
  } else if (process.env.VERCEL) {
    throw new Error("DATABASE_URL não configurada. Conecte um banco Neon ao projeto na Vercel e faça o redeploy.");
  } else {
    (await import("node:fs")).mkdirSync("./.data", { recursive: true });
    db = await createPglite("./.data/pglite");
  }
  await migrate(db);
  return db;
}

// Kept on globalThis so hot reload in development does not open a second database.
const globalForDb = globalThis as unknown as { vitrineDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  globalForDb.vitrineDb ??= connect().catch((error) => {
    // Do not cache a failure: the next request tries again (e.g. Neon waking up from idle).
    globalForDb.vitrineDb = undefined;
    throw error;
  });
  return globalForDb.vitrineDb;
}

/** For tests: a fresh in-memory database with the schema. */
export async function createTestDb(): Promise<Db> {
  const db = await createPglite();
  await migrate(db);
  return db;
}

export const toVectorLiteral = (values: ArrayLike<number>) => `[${Array.from(values).join(",")}]`;
