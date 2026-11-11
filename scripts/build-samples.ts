// Builds src/data/samples.json: the two example catalogs with their embeddings
// already computed, so creating a test store or the demo store spends no quota.
//   npx tsx --env-file=.env.local scripts/build-samples.ts
import { readFileSync, writeFileSync } from "node:fs";
import { parseCatalogCsv, searchTextOf, type ImportRow } from "../src/lib/catalog";
import { embedDocuments } from "../src/lib/embeddings";

interface SourceProduct {
  id: number;
  name: string;
  summary: string;
  categoryLabel: string;
  brand: string | null;
  priceBRL: number;
  stock: number;
  image: string;
  materials?: string;
}

// Project 6's catalog, translated and enriched in Portuguese. About five products per category.
const source: SourceProduct[] = JSON.parse(readFileSync("../semantic-catalog-search/data/catalog.json", "utf8"));
const perCategory = new Map<string, number>();
const demo: ImportRow[] = source
  .filter((p) => {
    const n = perCategory.get(p.categoryLabel) ?? 0;
    perCategory.set(p.categoryLabel, n + 1);
    return n < 5;
  })
  .slice(0, 100)
  .map((p) => ({
    id: String(p.id),
    title: p.name,
    description: p.summary,
    category: p.categoryLabel,
    priceBRL: p.priceBRL,
    stock: p.stock,
    imageUrl: p.image,
    attributes: Object.fromEntries([["marca", p.brand], ["material", p.materials]].filter(([, v]) => v)) as Record<string, string>,
  }));

const cafe = parseCatalogCsv(readFileSync("src/data/sample-cafe.csv", "utf8"));
if (cafe.errors.length) throw new Error(JSON.stringify(cafe.errors));

const round = (v: number[]) => v.map((x) => Math.round(x * 1e5) / 1e5);
// The free tier counts each text as one request, 100 per minute: batches of 40, a minute apart.
let first = true;
async function embed(rows: ImportRow[]) {
  const out: number[][] = [];
  for (let i = 0; i < rows.length; i += 40) {
    if (!first) await new Promise((r) => setTimeout(r, 61_000));
    first = false;
    out.push(...(await embedDocuments(rows.slice(i, i + 40).map(searchTextOf))).map(round));
    console.log(`embedded ${out.length}/${rows.length}`);
  }
  return out;
}

const samples = {
  cafe: { name: "Café da Serra", rows: cafe.rows, embeddings: await embed(cafe.rows) },
  demo: { name: "Vitrine Demo", rows: demo, embeddings: await embed(demo) },
};
writeFileSync("src/data/samples.json", JSON.stringify(samples));
console.log(`cafe: ${cafe.rows.length} products, demo: ${demo.length} products, ${samples.demo.embeddings[0]!.length} dimensions`);
