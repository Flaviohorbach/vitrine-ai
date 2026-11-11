import { getDb } from "@/lib/db";
import { createMcpEndpoint, deploymentHostnames } from "@/lib/mcp";
import { embedQuery } from "@/lib/server";

// Each store's own MCP server: https://<site>/api/mcp/<slug>, with that store's token.
const handle = createMcpEndpoint({ getDb, embedQuery, allowedHostnames: deploymentHostnames() });

const route = async (request: Request, { params }: { params: Promise<{ slug: string }> }) => handle(request, (await params).slug);
export const POST = route;
export const GET = route;
export const DELETE = route;
