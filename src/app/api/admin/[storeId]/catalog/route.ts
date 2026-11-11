import { z } from "zod";
import { MAX_PRODUCTS, parseCatalogCsv, replaceCatalog } from "@/lib/catalog";
import { adminStore, json } from "@/lib/server";

const Body = z.object({ csv: z.string().min(10).max(500_000) });

/** Replaces the catalog with a CSV. Products are saved at once; embeddings follow in batches (see ../embeddings). */
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const auth = await adminStore(request, (await params).storeId);
  if (auth instanceof Response) return auth;
  const { db, store } = auth;
  if (store.isDemo) return json({ error: "A loja de demonstração não pode ser alterada." }, 403);

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "Envie o conteúdo de um arquivo CSV." }, 400);

  const { rows, errors } = parseCatalogCsv(body.data.csv);
  if (!rows.length) return json({ error: "Nenhum produto válido no arquivo.", errors: errors.slice(0, 50) }, 400);
  if (rows.length > MAX_PRODUCTS) return json({ error: `O arquivo tem ${rows.length} produtos. O limite da demonstração é ${MAX_PRODUCTS}.` }, 400);

  await replaceCatalog(db, store.id, rows);
  return json({ imported: rows.length, errors: errors.slice(0, 50) });
}
