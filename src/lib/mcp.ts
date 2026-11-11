import { createMcpHandler, hostHeaderValidationResponse, McpServer, originValidationResponse } from "@modelcontextprotocol/server";
import { z } from "zod";
import { categories as listCategories, getProducts, searchCatalog, summarize } from "./catalog";
import type { Db } from "./db";
import { createRateLimiter } from "./rate-limit";
import { authorizeMcp, bumpUsage, type Store } from "./stores";

const ProductOut = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  priceBRL: z.number(),
  stock: z.number(),
  imageUrl: z.string().nullable(),
  description: z.string(),
});

const toolResult = <T extends Record<string, unknown>>(data: T) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data });
const toolError = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });

/**
 * One server per request, bound to one store (project 7's pattern). The
 * store comes from the token, so there is no argument a client could change
 * to reach another store's catalog. Read-only on purpose.
 */
export function createStoreMcpServer(db: Db, store: Store, embedQuery: (text: string) => Promise<number[]>): McpServer {
  const server = new McpServer({ name: `vitrine-ai-${store.slug}`, version: "1.0.0" });

  server.registerTool(
    "search_products",
    {
      title: `Buscar produtos na ${store.name}`,
      description: `Busca no catálogo da loja ${store.name}, por sentido e por palavras. Aceita frases como "presente para quem gosta de café até 100 reais": o preço vira filtro exato.`,
      inputSchema: z.object({
        query: z.string().max(200).describe("O que procurar, em português."),
        maxPriceBRL: z.number().positive().optional(),
        category: z.string().max(80).optional(),
        limit: z.number().int().min(1).max(12).default(6),
      }),
      outputSchema: z.object({ products: z.array(ProductOut), semantic: z.boolean() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, maxPriceBRL, category, limit }) => {
      const result = await searchCatalog(db, store.id, { query, maxPrice: maxPriceBRL ?? null, category: category ?? null, limit }, embedQuery);
      return toolResult({ products: result.products, semantic: result.semantic });
    },
  );

  server.registerTool(
    "get_product",
    {
      title: "Ver um produto",
      description: "Detalhes de um produto, incluindo características. Use um id devolvido por search_products.",
      inputSchema: z.object({ id: z.string().max(64) }),
      outputSchema: ProductOut.extend({ attributes: z.record(z.string(), z.string()) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const [product] = await getProducts(db, store.id, [id]);
      if (!product) return toolError(`Produto ${id} não existe nesta loja. Encontre o id com search_products.`);
      return toolResult({ ...summarize(product), attributes: product.attributes });
    },
  );

  server.registerTool(
    "list_categories",
    {
      title: "Listar categorias",
      description: `As categorias do catálogo da ${store.name}.`,
      inputSchema: z.object({}),
      outputSchema: z.object({ categories: z.array(z.string()) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => toolResult({ categories: await listCategories(db, store.id) }),
  );

  return server;
}

const json = (status: number, error: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json", ...headers } });

export interface McpEndpointOptions {
  getDb: () => Promise<Db>;
  embedQuery: (text: string) => Promise<number[]>;
  allowedHostnames: string[];
  /** Calls per minute for one store. */
  rateLimit?: number;
  /** Failed logins per minute for one address: what makes guessing tokens slow. */
  authFailureLimit?: number;
}

/** Checks in order: where the request came from, which store, how often, and only then the protocol. */
export function createMcpEndpoint({ getDb, embedQuery, allowedHostnames, rateLimit = 60, authFailureLimit = 20 }: McpEndpointOptions) {
  const callLimiter = createRateLimiter({ limit: rateLimit, windowMs: 60_000 });
  const failureLimiter = createRateLimiter({ limit: authFailureLimit, windowMs: 60_000 });

  return async function handle(request: Request, slug: string): Promise<Response> {
    // The protocol handler trusts its caller. These stop DNS rebinding and calls from other sites' pages.
    const rejected = hostHeaderValidationResponse(request, allowedHostnames) ?? originValidationResponse(request, allowedHostnames);
    if (rejected) return rejected;

    const db = await getDb();
    const store = await authorizeMcp(db, slug, request.headers.get("authorization"));
    if (!store) {
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
      const { allowed, retryAfterMs } = failureLimiter(ip);
      if (!allowed) return json(429, "Too many failed attempts.", { "retry-after": String(Math.ceil(retryAfterMs / 1000)) });
      return json(401, "Missing or invalid bearer token for this store.", { "www-authenticate": "Bearer" });
    }

    const { allowed, retryAfterMs } = callLimiter(store.id);
    if (!allowed) return json(429, "Rate limit exceeded.", { "retry-after": String(Math.ceil(retryAfterMs / 1000)) });
    await bumpUsage(db, store.id, "mcp");

    const handler = createMcpHandler(() => createStoreMcpServer(db, store, embedQuery), { maxRequestBodySize: 64 * 1024, responseMode: "json" });
    return handler.fetch(request);
  };
}

/** The hostnames this deployment answers on. */
export function deploymentHostnames(env: NodeJS.ProcessEnv = process.env): string[] {
  const urls = [env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_URL, env.VERCEL_BRANCH_URL].filter(Boolean) as string[];
  return [...new Set([...urls.map((url) => url.split(":")[0]!), "localhost", "127.0.0.1"])];
}
