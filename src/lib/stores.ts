import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "./db";

export interface Store {
  id: string;
  slug: string;
  name: string;
  isDemo: boolean;
}

interface StoreRow {
  id: string;
  slug: string;
  name: string;
  is_demo: boolean;
  admin_token_hash: string;
  mcp_token_hash: string;
}

const toStore = (row: StoreRow): Store => ({ id: row.id, slug: row.slug, name: row.name, isDemo: row.is_demo });

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = (prefix: string) => `${prefix}_${randomBytes(24).toString("base64url")}`;

/** "Café da Serra!" → "cafe-da-serra". A random suffix keeps two stores with one name apart. */
export function slugify(name: string): string {
  const base = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return `${base || "loja"}-${randomBytes(3).toString("hex")}`;
}

export interface CreatedStore extends Store {
  /** Shown once, inside the admin link. Only its hash is stored. */
  adminToken: string;
  mcpToken: string;
}

/**
 * No accounts: a store is owned by whoever holds its admin link, as in
 * Excalidraw or a Google Docs "anyone with the link". Tokens are stored as
 * hashes, so a database leak does not hand out working links.
 */
export async function createStore(db: Db, name: string, options: { isDemo?: boolean; id?: string; slug?: string } = {}): Promise<CreatedStore> {
  const id = options.id ?? randomBytes(8).toString("hex");
  const slug = options.slug ?? slugify(name);
  const adminToken = newToken("adm");
  const mcpToken = newToken("mcp");
  await db.query(
    "INSERT INTO stores (id, slug, name, admin_token_hash, mcp_token_hash, is_demo) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, slug, name.trim().slice(0, 60), hashToken(adminToken), hashToken(mcpToken), options.isDemo ?? false],
  );
  return { id, slug, name, isDemo: options.isDemo ?? false, adminToken, mcpToken };
}

/** Constant-time comparison of hashes, so timing reveals nothing about a token. */
function sameHash(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

const bearer = (header: string | null) => /^Bearer\s+(\S+)$/i.exec(header ?? "")?.[1] ?? null;

export async function storeBySlug(db: Db, slug: string): Promise<Store | null> {
  const [row] = await db.query<StoreRow>("SELECT * FROM stores WHERE slug = $1", [slug]);
  return row ? toStore(row) : null;
}

/** The store, if the request carries its admin token. */
export async function authorizeAdmin(db: Db, storeId: string, authorization: string | null): Promise<Store | null> {
  const token = bearer(authorization);
  if (!token) return null;
  const [row] = await db.query<StoreRow>("SELECT * FROM stores WHERE id = $1", [storeId]);
  if (!row || !sameHash(token, row.admin_token_hash)) return null;
  await db.query("UPDATE stores SET last_active_at = now() WHERE id = $1", [storeId]);
  return toStore(row);
}

/** The store, if the request carries its MCP token. The token is per store: one store's agent cannot read another. */
export async function authorizeMcp(db: Db, slug: string, authorization: string | null): Promise<Store | null> {
  const token = bearer(authorization);
  if (!token) return null;
  const [row] = await db.query<StoreRow>("SELECT * FROM stores WHERE slug = $1", [slug]);
  return row && sameHash(token, row.mcp_token_hash) ? toStore(row) : null;
}

/** A leaked MCP token is replaced, and the old one stops working at once. */
export async function rotateMcpToken(db: Db, storeId: string): Promise<string> {
  const token = newToken("mcp");
  await db.query("UPDATE stores SET mcp_token_hash = $2 WHERE id = $1", [storeId, hashToken(token)]);
  return token;
}

export async function storesCreatedToday(db: Db): Promise<number> {
  const [row] = await db.query<{ n: string | number }>("SELECT count(*) AS n FROM stores WHERE NOT is_demo AND created_at > now() - interval '1 day'");
  return Number(row!.n);
}

/** Visitors' stores are a demo: they are removed after a week without use. */
export async function purgeIdleStores(db: Db, days = 7) {
  await db.query(`DELETE FROM stores WHERE NOT is_demo AND last_active_at < now() - make_interval(days => $1)`, [days]);
}

/** Counts per store and day, for the free-quota limits and the panel. */
export async function bumpUsage(db: Db, storeId: string, kind: string, by = 1): Promise<number> {
  const [row] = await db.query<{ n: number }>(
    `INSERT INTO usage (store_id, kind, n) VALUES ($1, $2, $3)
     ON CONFLICT (store_id, day, kind) DO UPDATE SET n = usage.n + $3 RETURNING n`,
    [storeId, kind, by],
  );
  return row!.n;
}

export async function usageToday(db: Db, storeId: string): Promise<Record<string, number>> {
  const rows = await db.query<{ kind: string; n: number }>("SELECT kind, n FROM usage WHERE store_id = $1 AND day = CURRENT_DATE", [storeId]);
  return Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)]));
}
