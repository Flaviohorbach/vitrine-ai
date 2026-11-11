import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { beforeAll, describe, expect, it } from "vitest";
import { parseCatalogCsv, replaceCatalog } from "../src/lib/catalog";
import { createTestDb, EMBEDDING_DIMENSIONS, type Db } from "../src/lib/db";
import { createMcpEndpoint } from "../src/lib/mcp";
import { createStore, type CreatedStore } from "../src/lib/stores";

const fakeEmbed = async (text: string) => {
  const v = new Array(EMBEDDING_DIMENSIONS).fill(0);
  v[text.toLowerCase().includes("caf") ? 0 : 1] = 1;
  return v;
};

let db: Db;
let a: CreatedStore;
let b: CreatedStore;

beforeAll(async () => {
  db = await createTestDb();
  a = await createStore(db, "Café da Serra");
  b = await createStore(db, "Loja B");
  const { rows } = parseCatalogCsv(`sku,nome,categoria,preco\nC1,Café especial,Cafés,"54,90"\nC2,Caneca,Acessórios,"39,90"`);
  await replaceCatalog(db, a.id, rows, await Promise.all(rows.map((r) => fakeEmbed(r.title))));
  await replaceCatalog(db, b.id, [{ ...rows[0]!, id: "B1", title: "Café secreto da loja B" }], [await fakeEmbed("cafe")]);
});

const endpoint = (options: { rateLimit?: number; authFailureLimit?: number } = {}) =>
  createMcpEndpoint({ getDb: async () => db, embedQuery: fakeEmbed, allowedHostnames: ["localhost"], ...options });

/** A real MCP client over real HTTP requests, with the network replaced by a direct call. */
async function connect(slug: string, token: string, handle = endpoint()) {
  const url = `http://localhost:3000/api/mcp/${slug}`;
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("host", "localhost:3000");
      return handle(new Request(input, { ...init, headers }), slug);
    },
  });
  await client.connect(transport);
  return client;
}

const post = (handle: ReturnType<typeof endpoint>, slug: string, headers: Record<string, string>) =>
  handle(
    new Request(`http://localhost:3000/api/mcp/${slug}`, {
      method: "POST",
      headers: { host: "localhost:3000", "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
    slug,
  );

describe("MCP per store", () => {
  it("lists three read-only tools and searches the store's own catalog", async () => {
    const client = await connect(a.slug, a.mcpToken);
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(["get_product", "list_categories", "search_products"]);
    const result = await client.callTool({ name: "search_products", arguments: { query: "café" } });
    const ids = (result.structuredContent as { products: { id: string }[] }).products.map((p) => p.id);
    expect(ids[0]).toBe("C1");
    expect(ids).not.toContain("B1");
  });

  it("cannot read another store's product even by id", async () => {
    const client = await connect(a.slug, a.mcpToken);
    const result = await client.callTool({ name: "get_product", arguments: { id: "B1" } });
    expect(result.isError).toBe(true);
  });

  it("rejects a token from another store, and a missing one", async () => {
    const handle = endpoint();
    expect((await post(handle, a.slug, { authorization: `Bearer ${b.mcpToken}` })).status).toBe(401);
    expect((await post(handle, a.slug, {})).status).toBe(401);
  });

  it("rejects requests from another site's page and slows down token guessing", async () => {
    const handle = endpoint({ authFailureLimit: 2 });
    expect((await post(handle, a.slug, { authorization: `Bearer ${a.mcpToken}`, origin: "https://evil.example" })).status).toBe(403);
    await post(handle, a.slug, { authorization: "Bearer wrong" });
    await post(handle, a.slug, { authorization: "Bearer wrong" });
    expect((await post(handle, a.slug, { authorization: "Bearer wrong" })).status).toBe(429);
  });
});
