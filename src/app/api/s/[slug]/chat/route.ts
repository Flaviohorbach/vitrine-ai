import { LangfuseClient } from "@langfuse/client";
import { getActiveTraceId, observe, propagateAttributes, setActiveTraceAsPublic, updateActiveObservation } from "@langfuse/tracing";
import { trace } from "@opentelemetry/api";
import { convertToModelMessages, streamText } from "ai";
import { after } from "next/server";
import { langfuseSpanProcessor, tracingEnabled } from "@/instrumentation";
import { categories } from "@/lib/catalog";
import { chatSettings, finishChat, prepareChat } from "@/lib/chat";
import { clientIp } from "@/lib/client-ip";
import { getDb } from "@/lib/db";
import { ensureDemoStore } from "@/lib/demo";
import { outputPassed } from "@/lib/guardrails";
import { DAILY_LIMITS } from "@/lib/limits";
import { createTierModels } from "@/lib/model";
import { costUSD } from "@/lib/pricing";
import { createRateLimiter } from "@/lib/rate-limit";
import { embedQuery } from "@/lib/server";
import { bumpUsage, storeBySlug } from "@/lib/stores";
import { createShopTools, type ShopUIMessage } from "@/lib/tools";

const models = createTierModels();
const rateLimit = createRateLimiter({ limit: 12, windowMs: 10 * 60_000 });
const langfuse = tracingEnabled ? new LangfuseClient() : null;

const traceUrl = (traceId: string | undefined) =>
  traceId && process.env.LANGFUSE_PROJECT_ID
    ? `${process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com"}/project/${process.env.LANGFUSE_PROJECT_ID}/traces/${traceId}`
    : null;

// Two or three steps, each of which may wait 15 s for a slow model before falling back (project 11's lesson).
export const maxDuration = 60;

async function handler(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { allowed, retryAfterMs } = rateLimit(clientIp(request));
  if (!allowed) return new Response(`Você enviou muitas mensagens seguidas. Tente de novo em ${Math.ceil(retryAfterMs / 60_000)} min.`, { status: 429 });

  const db = await getDb();
  await ensureDemoStore(db);
  const store = await storeBySlug(db, (await params).slug);
  if (!store) return new Response("Loja não encontrada.", { status: 404 });
  // Each store gets its share of the free quota; one busy store cannot take everyone's.
  if ((await bumpUsage(db, store.id, "chat")) > DAILY_LIMITS.chat) return new Response("O assistente desta loja atingiu o limite de hoje. Volte amanhã!", { status: 429 });

  const { messages }: { messages: ShopUIMessage[] } = await request.json();
  const prepared = prepareChat(messages);
  const { route } = prepared;
  const tools = createShopTools({ db, storeId: store.id, categories: await categories(db, store.id), embedQuery });
  const started = Date.now();
  const traceId = getActiveTraceId();
  if (tracingEnabled) {
    // Personal data was masked above, and model inputs are not recorded, so the trace can be public.
    setActiveTraceAsPublic();
    updateActiveObservation({ input: prepared.messages.at(-1)?.parts });
  }
  const tags = [`store:${store.slug}`, `tier:${route.tier}`, ...(prepared.injectionSuspected ? ["injection-suspected"] : []), ...(prepared.maskedData.length ? ["personal-data-masked"] : [])];

  return propagateAttributes({ traceName: "store-chat", tags, metadata: { store: store.slug, routeReason: route.reason } }, async () => {
    let stepCost: number | null = 0;
    const stepModels = new Set<string>();

    const result = streamText({
      model: models[route.tier],
      ...chatSettings(store.name, tools),
      messages: await convertToModelMessages(prepared.messages),
      providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
      // Model inputs hold the system prompt and its canary, and traces are public (project 11's lesson).
      telemetry: { functionId: "store-chat", recordInputs: false },
      onFinish: async ({ text, steps }) => {
        const finished = finishChat(text, steps, prepared.lastUserText);
        if (!tracingEnabled) return;
        updateActiveObservation({ output: text, metadata: { ...finished, tier: route.tier } });
        if (traceId && langfuse) {
          langfuse.score.create({ traceId, name: "output-guardrails", value: outputPassed(finished.check) ? 1 : 0, comment: JSON.stringify(finished.check) });
          if (finished.costUSD !== null) langfuse.score.create({ traceId, name: "cost-usd", value: finished.costUSD });
        }
        trace.getActiveSpan()?.end();
      },
      onError: async ({ error }) => {
        if (tracingEnabled) {
          updateActiveObservation({ output: String(error), level: "ERROR" });
          trace.getActiveSpan()?.end();
        }
      },
    });

    after(async () => {
      await langfuseSpanProcessor?.forceFlush();
      await langfuse?.flush();
    });

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      messageMetadata: ({ part }) => {
        if (part.type === "start") return { tier: route.tier, routeReason: route.reason, injectionSuspected: prepared.injectionSuspected, maskedData: prepared.maskedData, traceUrl: traceUrl(traceId) };
        if (part.type === "finish-step") {
          stepModels.add(part.response.modelId);
          const cost = costUSD(part.response.modelId, part.usage);
          stepCost = cost === null || stepCost === null ? null : stepCost + cost;
        }
        if (part.type === "finish") return { models: [...stepModels], costUSD: stepCost, inputTokens: part.totalUsage.inputTokens, outputTokens: part.totalUsage.outputTokens, ms: Date.now() - started };
        return undefined;
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (/per day|quota/i.test(message)) return "A demonstração atingiu o limite gratuito de hoje. Volte amanhã!";
        if (/high demand|overloaded|503/i.test(message)) return "O modelo está sobrecarregado agora. Tente de novo em alguns segundos.";
        console.error("chat error:", message);
        return "Algo deu errado do nosso lado. Tente de novo.";
      },
    });
  });
}

export const POST = tracingEnabled ? observe(handler, { name: "store-chat-request", endOnExit: false }) : handler;
