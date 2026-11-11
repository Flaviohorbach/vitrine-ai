import { z } from "zod";
import { clientIp } from "@/lib/client-ip";
import { replaceCatalog } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { SAMPLE_CAFE } from "@/lib/demo";
import { createRateLimiter } from "@/lib/rate-limit";
import { json } from "@/lib/server";
import { createStore, purgeIdleStores, storesCreatedToday } from "@/lib/stores";

const limiter = createRateLimiter({ limit: 3, windowMs: 60 * 60_000 });
const DAILY_STORE_LIMIT = Number(process.env.DAILY_STORE_LIMIT ?? 20);

const Body = z.object({ name: z.string().trim().min(2).max(60), sample: z.boolean().default(true) });

/**
 * Creates a store and returns its admin token once. The browser puts it in the
 * URL fragment (/painel/<id>#<token>): fragments are never sent to the server
 * or in the Referer header, so the token does not end up in logs.
 */
export async function POST(request: Request) {
  const { allowed, retryAfterMs } = limiter(clientIp(request));
  if (!allowed) return json({ error: "Você já criou lojas demais nesta hora. Tente mais tarde." }, 429, { "retry-after": String(Math.ceil(retryAfterMs / 1000)) });

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "Dê um nome de 2 a 60 caracteres para a loja." }, 400);

  const db = await getDb();
  await purgeIdleStores(db);
  if ((await storesCreatedToday(db)) >= DAILY_STORE_LIMIT) return json({ error: "O limite de lojas de teste de hoje acabou. Volte amanhã." }, 429);

  const store = await createStore(db, body.data.name);
  // The sample catalog brings its embeddings: a test store is searchable at once and spends no quota.
  if (body.data.sample) await replaceCatalog(db, store.id, SAMPLE_CAFE.rows, SAMPLE_CAFE.embeddings);
  return json({ id: store.id, slug: store.slug, adminToken: store.adminToken }, 201);
}
