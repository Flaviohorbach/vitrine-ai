import { searchCatalog } from "@/lib/catalog";
import { clientIp } from "@/lib/client-ip";
import { getDb } from "@/lib/db";
import { ensureDemoStore } from "@/lib/demo";
import { createRateLimiter } from "@/lib/rate-limit";
import { embedQuery, json } from "@/lib/server";
import { storeBySlug } from "@/lib/stores";

const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

/** The storefront's search box: no model call, only an embedding (cached for repeated queries). */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!limiter(clientIp(request)).allowed) return json({ error: "Muitas buscas seguidas. Espere um pouco." }, 429);
  const { slug } = await params;
  const db = await getDb();
  await ensureDemoStore(db);
  const store = await storeBySlug(db, slug);
  if (!store) return json({ error: "Loja não encontrada." }, 404);

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").slice(0, 200);
  const category = url.searchParams.get("categoria");
  return json(await searchCatalog(db, store.id, { query, category, limit: 12 }, embedQuery));
}
