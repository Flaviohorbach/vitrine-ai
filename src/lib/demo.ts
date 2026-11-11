import samples from "@/data/samples.json";
import { replaceCatalog, type ImportRow } from "./catalog";
import type { Db } from "./db";
import { createStore, storeBySlug } from "./stores";

export const DEMO_SLUG = "vitrine-demo";
/**
 * Public on purpose, like project 7's demo tokens: it only reaches the demo
 * store's read-only catalog, and it lets anyone connect an agent in a minute.
 */
export const DEMO_MCP_TOKEN = "mcp_demo_vitrine";

export const SAMPLE_CAFE = samples.cafe as unknown as { name: string; rows: ImportRow[]; embeddings: number[][] };
const DEMO = samples.demo as unknown as { name: string; rows: ImportRow[]; embeddings: number[][] };

/** The demo store is created on first use from the bundled sample, embeddings included: no setup, no quota. */
export async function ensureDemoStore(db: Db) {
  const existing = await storeBySlug(db, DEMO_SLUG);
  if (existing) return existing;
  try {
    const store = await createStore(db, DEMO.name, { isDemo: true, id: "demo", slug: DEMO_SLUG, mcpToken: DEMO_MCP_TOKEN });
    await replaceCatalog(db, store.id, DEMO.rows, DEMO.embeddings);
    return store;
  } catch (error) {
    // Two first requests at once: the other one created it.
    const store = await storeBySlug(db, DEMO_SLUG);
    if (store) return store;
    throw error;
  }
}
