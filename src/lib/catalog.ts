import Papa from "papaparse";
import { z } from "zod";
import { toVectorLiteral, type Db } from "./db";
import { parseQuery, queryTerms } from "./query";

/** The free embedding quota is small and shared: a store holds at most this many products. */
export const MAX_PRODUCTS = 100;

export interface Product {
  id: string;
  title: string;
  description: string;
  category: string;
  priceBRL: number;
  stock: number;
  imageUrl: string | null;
  attributes: Record<string, string>;
  suggestedDescription: string | null;
  descriptionStatus: "none" | "pending" | "approved" | "rejected";
}

/** What the assistant, the search results and MCP clients see: no internal fields. */
export type ProductSummary = Pick<Product, "id" | "title" | "category" | "priceBRL" | "stock" | "imageUrl"> & { description: string };

interface ProductRow {
  id: string;
  title: string;
  description: string;
  category: string;
  price_brl: string | number;
  stock: number;
  image_url: string | null;
  attributes: Record<string, string>;
  suggested_description: string | null;
  description_status: Product["descriptionStatus"];
}

const toProduct = (r: ProductRow): Product => ({
  id: r.id,
  title: r.title,
  description: r.description,
  category: r.category,
  priceBRL: Number(r.price_brl),
  stock: Number(r.stock),
  imageUrl: r.image_url,
  attributes: r.attributes ?? {},
  suggestedDescription: r.suggested_description,
  descriptionStatus: r.description_status,
});

/** The description customers see: the store's own, or a generated one only after the store approved it. */
export const publicDescription = (p: Product) => (p.descriptionStatus === "approved" && p.suggestedDescription ? p.suggestedDescription : p.description);

export const summarize = (p: Product): ProductSummary => ({
  id: p.id,
  title: p.title,
  category: p.category,
  priceBRL: p.priceBRL,
  stock: p.stock,
  imageUrl: p.imageUrl,
  description: publicDescription(p),
});

// ---------- Import ----------

/** Brazilian spreadsheets write 1.299,90; others write 1299.90. Both are accepted. */
export function parsePrice(raw: string): number | null {
  const s = raw.replace(/R\$\s*/i, "").trim();
  if (!s) return null;
  const normalized = /,\d{1,2}$/.test(s) ? s.replaceAll(".", "").replace(",", ".") : s.replaceAll(",", "");
  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
}

const Row = z.object({
  id: z.string().trim().min(1).max(64),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).default(""),
  category: z.string().trim().max(80).default(""),
  priceBRL: z.number().min(0).max(1_000_000),
  stock: z.number().int().min(0).max(1_000_000).default(0),
  imageUrl: z.url({ protocol: /^https$/ }).nullable(),
  attributes: z.record(z.string(), z.string()),
});
export type ImportRow = z.infer<typeof Row>;

const HEADERS: Record<string, string[]> = {
  id: ["id", "sku", "codigo", "código"],
  title: ["title", "titulo", "título", "nome", "produto", "name"],
  description: ["description", "descricao", "descrição"],
  category: ["category", "categoria"],
  price: ["price", "preco", "preço", "valor"],
  stock: ["stock", "estoque", "quantidade"],
  image: ["image", "imagem", "image_url", "foto"],
  attributes: ["attributes", "atributos", "caracteristicas", "características"],
};

/** "cor=preto; tamanho=M" → { cor: "preto", tamanho: "M" }. */
export function parseAttributes(raw: string): Record<string, string> {
  return Object.fromEntries(
    raw
      .split(";")
      .map((pair) => pair.split("=").map((s) => s.trim()))
      .filter(([k, v]) => k && v)
      .slice(0, 20) as [string, string][],
  );
}

export interface ImportResult {
  rows: ImportRow[];
  errors: { line: number; message: string }[];
}

/**
 * A spreadsheet export, tolerant of Portuguese headers and Brazilian prices,
 * strict about everything else. Bad lines are reported, not guessed: a wrong
 * price on a storefront is worse than a missing product.
 */
export function parseCatalogCsv(text: string): ImportResult {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  const pick = (record: Record<string, string>, field: string) => {
    const key = HEADERS[field]!.find((h) => h in record);
    return key ? (record[key] ?? "").trim() : "";
  };
  const rows: ImportRow[] = [];
  const errors: ImportResult["errors"] = [];
  const seen = new Set<string>();

  parsed.data.forEach((record, index) => {
    const line = index + 2; // header is line 1
    const price = parsePrice(pick(record, "price"));
    if (price === null) return errors.push({ line, message: "preço ausente ou inválido" });
    const stockRaw = pick(record, "stock");
    const candidate = {
      id: pick(record, "id") || `linha-${line}`,
      title: pick(record, "title"),
      description: pick(record, "description"),
      category: pick(record, "category"),
      priceBRL: price,
      stock: stockRaw ? Number(stockRaw) : 0,
      imageUrl: pick(record, "image") || null,
      attributes: parseAttributes(pick(record, "attributes")),
    };
    const result = Row.safeParse(candidate);
    if (!result.success) return errors.push({ line, message: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    if (seen.has(result.data.id)) return errors.push({ line, message: `código repetido: ${result.data.id}` });
    seen.add(result.data.id);
    rows.push(result.data);
  });
  return { rows, errors };
}

/** Title, category, description and attributes: what both search methods read. */
export const searchTextOf = (p: Pick<Product, "title" | "category" | "description" | "attributes">) =>
  [p.title, p.category, p.description, ...Object.entries(p.attributes).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(". ");

/**
 * Replaces the store's catalog. Embeddings come from outside, so tests and
 * the demo seed can pass fixed vectors and spend no quota.
 */
export async function replaceCatalog(db: Db, storeId: string, rows: ImportRow[], embeddings: number[][]) {
  if (rows.length > MAX_PRODUCTS) throw new Error(`No máximo ${MAX_PRODUCTS} produtos por loja.`);
  await db.query("DELETE FROM products WHERE store_id = $1", [storeId]);
  for (const [i, r] of rows.entries()) {
    await db.query(
      `INSERT INTO products (store_id, id, title, description, category, price_brl, stock, image_url, attributes, search_text, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::vector)`,
      [storeId, r.id, r.title, r.description, r.category, r.priceBRL, r.stock, r.imageUrl, JSON.stringify(r.attributes), searchTextOf(r), toVectorLiteral(embeddings[i]!)],
    );
  }
}

// ---------- Read ----------

export async function listProducts(db: Db, storeId: string): Promise<Product[]> {
  return (await db.query<ProductRow>("SELECT * FROM products WHERE store_id = $1 ORDER BY title", [storeId])).map(toProduct);
}

export async function getProducts(db: Db, storeId: string, ids: string[]): Promise<Product[]> {
  if (!ids.length) return [];
  return (await db.query<ProductRow>("SELECT * FROM products WHERE store_id = $1 AND id = ANY($2::text[])", [storeId, ids])).map(toProduct);
}

export async function categories(db: Db, storeId: string): Promise<string[]> {
  return (await db.query<{ category: string }>("SELECT DISTINCT category FROM products WHERE store_id = $1 AND category <> '' ORDER BY category", [storeId])).map((r) => r.category);
}

// ---------- Search ----------

export interface SearchOptions {
  query: string;
  minPrice?: number | null;
  maxPrice?: number | null;
  category?: string | null;
  limit?: number;
}

export interface SearchResult {
  products: ProductSummary[];
  /** Price filters taken out of the words ("até 400"), so the page can show them. */
  filters: { minPrice: number | null; maxPrice: number | null; category: string | null };
  /** False when the embedding call failed and only keywords ran: search degrades instead of failing. */
  semantic: boolean;
}

/**
 * Hybrid search, as in project 6: keywords (Postgres full text) and meaning
 * (pgvector cosine), fused by rank. Prices and category are exact SQL
 * filters. Every query is scoped to one store.
 */
export async function searchCatalog(db: Db, storeId: string, options: SearchOptions, embedQuery: (text: string) => Promise<number[]>): Promise<SearchResult> {
  const parsed = parseQuery(options.query);
  const minPrice = options.minPrice ?? parsed.minPrice;
  const maxPrice = options.maxPrice ?? parsed.maxPrice;
  const category = options.category || null;
  const limit = Math.min(options.limit ?? 6, 12);

  const params: unknown[] = [storeId];
  const where = ["store_id = $1"];
  if (minPrice !== null) where.push(`price_brl >= $${params.push(minPrice)}`);
  if (maxPrice !== null) where.push(`price_brl <= $${params.push(maxPrice)}`);
  if (category) where.push(`lower(category) = lower($${params.push(category)})`);
  const filter = where.join(" AND ");

  const terms = queryTerms(parsed.text);
  const lists: string[][] = [];
  if (terms.length) {
    const tsquery = terms.join(" | ");
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM products WHERE ${filter} AND tsv @@ to_tsquery('portuguese', $${params.length + 1})
       ORDER BY ts_rank(tsv, to_tsquery('portuguese', $${params.length + 1})) DESC, id LIMIT 30`,
      [...params, tsquery],
    );
    lists.push(rows.map((r) => r.id));
  }

  let semantic = false;
  if (parsed.text) {
    try {
      const embedding = await embedQuery(parsed.text);
      const rows = await db.query<{ id: string }>(
        `SELECT id FROM products WHERE ${filter} AND embedding IS NOT NULL ORDER BY embedding <=> $${params.length + 1}::vector, id LIMIT 30`,
        [...params, toVectorLiteral(embedding)],
      );
      lists.push(rows.map((r) => r.id));
      semantic = true;
    } catch (error) {
      console.warn("semantic search off for this query:", (error as Error).message.slice(0, 120));
    }
  } else {
    // No words, only filters ("até 100 reais"): cheapest first.
    lists.push((await db.query<{ id: string }>(`SELECT id FROM products WHERE ${filter} ORDER BY price_brl, id LIMIT 30`, params)).map((r) => r.id));
  }

  // Reciprocal Rank Fusion (k = 60): combines ranks, so the two scores need no calibration.
  const scores = new Map<string, number>();
  for (const list of lists) list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (61 + rank)));
  const ids = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
  const found = await getProducts(db, storeId, ids);
  const byId = new Map(found.map((p) => [p.id, p]));
  return {
    products: ids.flatMap((id) => (byId.get(id) ? [summarize(byId.get(id)!)] : [])),
    filters: { minPrice, maxPrice, category },
    semantic,
  };
}
