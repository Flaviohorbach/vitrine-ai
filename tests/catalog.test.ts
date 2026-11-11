import { beforeEach, describe, expect, it } from "vitest";
import { MAX_PRODUCTS, parseCatalogCsv, parsePrice, replaceCatalog, searchCatalog } from "../src/lib/catalog";
import { createTestDb, EMBEDDING_DIMENSIONS, type Db } from "../src/lib/db";
import { authorizeAdmin, authorizeMcp, createStore, rotateMcpToken } from "../src/lib/stores";

/** A fake embedding: one dimension per "topic word", so meaning is predictable in tests. */
const TOPICS = ["cafe", "chocolate", "caneca", "chuva"];
const fakeEmbed = async (text: string) => {
  const v = new Array(EMBEDDING_DIMENSIONS).fill(0);
  TOPICS.forEach((t, i) => {
    if (text.toLowerCase().includes(t)) v[i] = 1;
  });
  if (v.every((x) => x === 0)) v[EMBEDDING_DIMENSIONS - 1] = 1;
  return v;
};
const embedAll = (texts: string[]) => Promise.all(texts.map(fakeEmbed));

const CSV = `sku,nome,descricao,categoria,preco,estoque,imagem,atributos
C1,Café especial torra média,"Grãos 100% arábica, notas de chocolate",Cafés,"54,90",12,https://example.com/c1.jpg,origem=Minas; peso=250 g
C2,Caneca de cerâmica,Caneca branca 300 ml,Acessórios,"39,90",30,,
C3,Café em cápsulas,Compatível com Nespresso,Cafés,"1.299,90",0,,`;

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

describe("CSV import", () => {
  it("reads Portuguese headers, Brazilian prices and attributes", () => {
    const { rows, errors } = parseCatalogCsv(CSV);
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.priceBRL)).toEqual([54.9, 39.9, 1299.9]);
    expect(rows[0]!.attributes).toEqual({ origem: "Minas", peso: "250 g" });
    expect(rows[1]!.imageUrl).toBeNull();
  });

  it("reports bad lines instead of guessing", () => {
    const csv = `sku,nome,preco,imagem\nA,Produto A,10,\nB,Produto B,10,http://inseguro.com/x.jpg\nA,Produto C,5,\nD,Produto D,abc,\nE,Produto E,12,`;
    const { rows, errors } = parseCatalogCsv(csv);
    expect(rows.map((r) => r.id)).toEqual(["A", "E"]);
    // http image, repeated code, invalid price
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5]);
  });

  it("parses both price styles", () => {
    expect(parsePrice("R$ 1.299,90")).toBe(1299.9);
    expect(parsePrice("1299.90")).toBe(1299.9);
    expect(parsePrice("-5")).toBeNull();
  });
});

describe("stores", () => {
  it("accepts only the right admin and MCP tokens, and a rotated MCP token stops working", async () => {
    const store = await createStore(db, "Café da Serra");
    expect(store.slug).toMatch(/^cafe-da-serra-[0-9a-f]{6}$/);
    expect(await authorizeAdmin(db, store.id, `Bearer ${store.adminToken}`)).not.toBeNull();
    expect(await authorizeAdmin(db, store.id, `Bearer ${store.mcpToken}`)).toBeNull();
    expect(await authorizeAdmin(db, store.id, null)).toBeNull();
    expect(await authorizeMcp(db, store.slug, `Bearer ${store.mcpToken}`)).not.toBeNull();
    const fresh = await rotateMcpToken(db, store.id);
    expect(await authorizeMcp(db, store.slug, `Bearer ${store.mcpToken}`)).toBeNull();
    expect(await authorizeMcp(db, store.slug, `Bearer ${fresh}`)).not.toBeNull();
  });

  it("does not let one store's token open another store", async () => {
    const a = await createStore(db, "Loja A");
    const b = await createStore(db, "Loja B");
    expect(await authorizeAdmin(db, b.id, `Bearer ${a.adminToken}`)).toBeNull();
    expect(await authorizeMcp(db, b.slug, `Bearer ${a.mcpToken}`)).toBeNull();
  });
});

describe("search", () => {
  it("finds by meaning and keywords, applies price filters, and stays inside one store", async () => {
    const a = await createStore(db, "Loja A");
    const b = await createStore(db, "Loja B");
    const { rows } = parseCatalogCsv(CSV);
    await replaceCatalog(db, a.id, rows, await embedAll(rows.map((r) => r.title)));
    await replaceCatalog(db, b.id, [{ ...rows[0]!, id: "OUTRA", title: "Café da loja B" }], [await fakeEmbed("cafe")]);

    const coffee = await searchCatalog(db, a.id, { query: "café até 100 reais" }, fakeEmbed);
    expect(coffee.filters.maxPrice).toBe(100);
    // Vector search always returns the nearest products, so the mug follows the coffee; the R$ 1.299,90 one is filtered out.
    expect(coffee.products[0]!.id).toBe("C1");
    expect(coffee.products.map((p) => p.id)).not.toContain("C3");
    expect(coffee.semantic).toBe(true);

    const everything = await searchCatalog(db, a.id, { query: "café" }, fakeEmbed);
    expect(everything.products.map((p) => p.id)).not.toContain("OUTRA");
  });

  it("falls back to keywords when embeddings fail", async () => {
    const store = await createStore(db, "Loja");
    const { rows } = parseCatalogCsv(CSV);
    await replaceCatalog(db, store.id, rows, await embedAll(rows.map((r) => r.title)));
    const result = await searchCatalog(db, store.id, { query: "caneca" }, () => Promise.reject(new Error("quota")));
    expect(result.semantic).toBe(false);
    expect(result.products[0]!.id).toBe("C2");
  });

  it("refuses catalogs over the limit", async () => {
    const store = await createStore(db, "Loja");
    const row = parseCatalogCsv(CSV).rows[0]!;
    const many = Array.from({ length: MAX_PRODUCTS + 1 }, (_, i) => ({ ...row, id: `P${i}` }));
    await expect(replaceCatalog(db, store.id, many, [])).rejects.toThrow(/No máximo/);
  });
});

import { checkDescription, reviewSuggestion, saveSuggestion } from "../src/lib/descriptions";
import { listProducts } from "../src/lib/catalog";

describe("generated descriptions", () => {
  const product = { title: "Camiseta básica", description: "Camiseta preta", category: "Moda", attributes: { tamanho: "M", tecido: "algodão" } };

  it("passes a description that sticks to the data", () => {
    expect(checkDescription("Camiseta básica preta de algodão, no tamanho M. Combina com tudo.", product)).toEqual({ inventedNumbers: [], unsupportedClaims: [] });
  });

  it("flags invented numbers and claims", () => {
    const check = checkDescription("Feita com 100% algodão orgânico, com garantia de 1 ano e frete grátis.", product);
    expect(check.inventedNumbers).toEqual(["100", "1"]);
    expect(check.unsupportedClaims).toEqual(["orgânico", "garantia", "frete grátis"]);
  });

  it("keeps a suggestion private until a person approves it", async () => {
    const store = await createStore(db, "Loja");
    const { rows } = parseCatalogCsv(CSV);
    await replaceCatalog(db, store.id, rows, await embedAll(rows.map((r) => r.title)));
    await saveSuggestion(db, store.id, "C2", "Caneca branca de cerâmica, com 300 ml.");
    let [mug] = (await listProducts(db, store.id)).filter((p) => p.id === "C2");
    expect(mug!.descriptionStatus).toBe("pending");
    expect(await reviewSuggestion(db, store.id, "C2", "approved", "Caneca branca de cerâmica para 300 ml.")).toBe(true);
    expect(await reviewSuggestion(db, store.id, "C2", "approved")).toBe(false); // only once
    [mug] = (await listProducts(db, store.id)).filter((p) => p.id === "C2");
    expect(mug!.suggestedDescription).toBe("Caneca branca de cerâmica para 300 ml.");
  });
});

import { embedPending, pendingEmbeddings } from "../src/lib/catalog";

describe("deferred embeddings", () => {
  it("saves an upload at once, searches it by keywords, and embeds it in batches", async () => {
    const store = await createStore(db, "Loja");
    const { rows } = parseCatalogCsv(CSV);
    await replaceCatalog(db, store.id, rows);
    expect(await pendingEmbeddings(db, store.id)).toBe(3);
    const before = await searchCatalog(db, store.id, { query: "caneca" }, fakeEmbed);
    expect(before.products[0]!.id).toBe("C2");
    expect(await embedPending(db, store.id, embedAll, 2)).toBe(2);
    expect(await embedPending(db, store.id, embedAll, 2)).toBe(1);
    expect(await pendingEmbeddings(db, store.id)).toBe(0);
  });
});
