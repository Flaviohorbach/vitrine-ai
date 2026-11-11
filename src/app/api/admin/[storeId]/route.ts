import { categories, listProducts, MAX_PRODUCTS, pendingEmbeddings } from "@/lib/catalog";
import { THIN_DESCRIPTION } from "@/lib/descriptions";
import { adminStore, json } from "@/lib/server";
import { usageToday } from "@/lib/stores";
import { DAILY_LIMITS } from "@/lib/limits";

/** Everything the panel shows. The MCP token is not here: only its hash exists, so it is shown once when generated. */
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const auth = await adminStore(request, (await params).storeId);
  if (auth instanceof Response) return auth;
  const { db, store } = auth;
  const products = await listProducts(db, store.id);
  return json({
    store,
    products,
    categories: await categories(db, store.id),
    pendingEmbeddings: await pendingEmbeddings(db, store.id),
    thinDescriptions: products.filter((p) => p.description.length < THIN_DESCRIPTION && p.descriptionStatus !== "approved").length,
    usage: await usageToday(db, store.id),
    limits: { maxProducts: MAX_PRODUCTS, ...DAILY_LIMITS },
  });
}
