import { z } from "zod";
import { getProducts } from "@/lib/catalog";
import { checkDescription, reviewSuggestion } from "@/lib/descriptions";
import { adminStore, json } from "@/lib/server";

const Body = z.object({ decision: z.enum(["approved", "rejected"]), text: z.string().trim().min(10).max(1000).optional() });

/** A person approves (possibly after editing) or rejects a suggestion. Only approved text reaches customers. */
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string; productId: string }> }) {
  const { storeId, productId } = await params;
  const auth = await adminStore(request, storeId);
  if (auth instanceof Response) return auth;
  const { db, store } = auth;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "Decisão inválida." }, 400);

  const ok = await reviewSuggestion(db, store.id, productId, body.data.decision, body.data.text);
  if (!ok) return json({ error: "Esta sugestão não está esperando revisão." }, 409);
  const [product] = await getProducts(db, store.id, [productId]);
  // An edit is checked again: a person can also type a claim the data does not support.
  return json({ ok: true, check: body.data.text && product ? checkDescription(body.data.text, product) : null });
}
