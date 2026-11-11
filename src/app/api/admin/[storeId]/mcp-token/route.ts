import { adminStore, json } from "@/lib/server";
import { rotateMcpToken } from "@/lib/stores";

/** Generates a new MCP token, shown once. The previous one stops working at once. */
export async function POST(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  const auth = await adminStore(request, (await params).storeId);
  if (auth instanceof Response) return auth;
  const { db, store } = auth;
  if (store.isDemo) return json({ error: "A loja de demonstração usa um token público." }, 403);
  return json({ token: await rotateMcpToken(db, store.id) });
}
