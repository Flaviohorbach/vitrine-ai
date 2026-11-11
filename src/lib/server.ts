import { getDb, type Db } from "./db";
import { embedQuery as embedRemote } from "./embeddings";
import { authorizeAdmin, type Store } from "./stores";

/** Repeated searches (the example buttons) reuse their embedding instead of spending quota again. */
const queryCache = new Map<string, number[]>();
export async function embedQuery(text: string): Promise<number[]> {
  const key = text.trim().toLowerCase();
  const hit = queryCache.get(key);
  if (hit) return hit;
  const embedding = await embedRemote(key);
  if (queryCache.size > 500) queryCache.delete(queryCache.keys().next().value!);
  queryCache.set(key, embedding);
  return embedding;
}

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });

/** The store behind an admin request, or the 401 to return. */
export async function adminStore(request: Request, storeId: string): Promise<{ db: Db; store: Store } | Response> {
  const db = await getDb();
  const store = await authorizeAdmin(db, storeId, request.headers.get("authorization"));
  if (!store) return json({ error: "Link de administração inválido." }, 401);
  return { db, store };
}
