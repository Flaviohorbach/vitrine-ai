import { listProducts } from "@/lib/catalog";
import { descriptionPassed, generateDescription, saveSuggestion, THIN_DESCRIPTION } from "@/lib/descriptions";
import { createTierModels } from "@/lib/model";
import { adminStore, json } from "@/lib/server";
import { bumpUsage, usageToday } from "@/lib/stores";
import { DAILY_LIMITS } from "@/lib/limits";

const models = createTierModels();
/** A few per click: each is a model call, and the panel shows them as they come. */
const PER_REQUEST = 3;

/** Suggests descriptions for the thinnest products. Each one waits for the store's review. */
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const auth = await adminStore(request, (await params).storeId);
  if (auth instanceof Response) return auth;
  const { db, store } = auth;
  if (store.isDemo) return json({ error: "A loja de demonstração não pode ser alterada." }, 403);

  const used = (await usageToday(db, store.id)).descriptions ?? 0;
  const room = Math.min(PER_REQUEST, DAILY_LIMITS.descriptions - used);
  if (room <= 0) return json({ error: `Limite de ${DAILY_LIMITS.descriptions} descrições por dia atingido.` }, 429);

  const candidates = (await listProducts(db, store.id))
    .filter((p) => p.description.length < THIN_DESCRIPTION && (p.descriptionStatus === "none" || p.descriptionStatus === "rejected"))
    .slice(0, room);
  if (!candidates.length) return json({ generated: [], message: "Nenhum produto com descrição curta esperando sugestão." });

  const generated = [];
  for (const product of candidates) {
    try {
      const { text, check } = await generateDescription(models.fast, product);
      await saveSuggestion(db, store.id, product.id, text);
      await bumpUsage(db, store.id, "descriptions");
      generated.push({ id: product.id, text, check, passed: descriptionPassed(check) });
    } catch (error) {
      generated.push({ id: product.id, error: (error as Error).message.slice(0, 120) });
      break;
    }
  }
  return json({ generated });
}
