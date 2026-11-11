import { embedPending, pendingEmbeddings } from "@/lib/catalog";
import { embedDocuments } from "@/lib/embeddings";
import { adminStore, json } from "@/lib/server";

/**
 * Embeds the next batch. The panel calls this about once a minute while
 * products wait: the free tier embeds 100 texts a minute, shared by every store.
 */
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const auth = await adminStore(request, (await params).storeId);
  if (auth instanceof Response) return auth;
  const { db, store } = auth;
  try {
    const embedded = await embedPending(db, store.id, embedDocuments, 40);
    return json({ embedded, pending: await pendingEmbeddings(db, store.id) });
  } catch (error) {
    const message = (error as Error).message;
    const quota = /quota|rate|429|exhausted/i.test(message);
    return json({ embedded: 0, pending: await pendingEmbeddings(db, store.id), retryInSeconds: quota ? 65 : 30, error: quota ? "Cota de embeddings ocupada; nova tentativa em 1 minuto." : "Falha temporária ao calcular embeddings." });
  }
}
