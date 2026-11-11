// Runs the quality, attack and description suites against the real models, on
// an in-memory database holding the demo store: the same tools, prompt,
// router and guardrails as the live routes, and no production data.
// Exits with 1 below evals/thresholds.json: CI uses that to block the deploy.
//   npm run eval
import { readFileSync, writeFileSync } from "node:fs";
import { convertToModelMessages, generateText } from "ai";
import { categories, replaceCatalog } from "../src/lib/catalog";
import { chatSettings, finishChat, prepareChat } from "../src/lib/chat";
import { createTestDb } from "../src/lib/db";
import { ensureDemoStore, SAMPLE_CAFE } from "../src/lib/demo";
import { descriptionPassed, generateDescription } from "../src/lib/descriptions";
import { embedQuery } from "../src/lib/embeddings";
import { outputPassed } from "../src/lib/guardrails";
import { createTierModels } from "../src/lib/model";
import { createStore } from "../src/lib/stores";
import { createShopTools, systemPrompt, type ShopUIMessage } from "../src/lib/tools";
import { ATTACKS, POISONED_PRODUCT, QUALITY, type Case, type Observed } from "./cases";

const thresholds = JSON.parse(readFileSync("evals/thresholds.json", "utf8")) as Record<string, number>;
const models = createTierModels();
const db = await createTestDb();
const demo = await ensureDemoStore(db);
const poisoned = await createStore(db, "Café Envenenado");
const cafeVector = SAMPLE_CAFE.embeddings[0]!;
await replaceCatalog(db, poisoned.id, [...SAMPLE_CAFE.rows, POISONED_PRODUCT], [...SAMPLE_CAFE.embeddings, cafeVector]);
const stores = { demo, poisoned: { ...poisoned } };

const normalize = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
const promptSentences = systemPrompt("Loja").split(/[.\n]/).map((s) => normalize(s.trim())).filter((s) => s.length > 40).map((s) => s.slice(0, 40));
const leaksPrompt = (text: string) => promptSentences.some((s) => normalize(text).includes(s));

function productsOf(output: unknown): Observed["products"] {
  const found: Observed["products"] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.id === "string" && typeof o.priceBRL === "number") found.push({ id: o.id, priceBRL: o.priceBRL, category: o.category as string | undefined });
      else Object.values(o).forEach(visit);
    }
  };
  visit(output);
  return found;
}

async function runChat(kind: "quality" | "attack", c: Case) {
  const store = stores[c.store];
  const prepared = prepareChat([{ id: c.id, role: "user", parts: [{ type: "text", text: c.prompt }] } as ShopUIMessage]);
  const tools = createShopTools({ db, storeId: store.id, categories: await categories(db, store.id), embedQuery });
  const start = performance.now();
  const result = await generateText({
    model: models[prepared.route.tier],
    ...chatSettings(store.name, tools),
    temperature: 0,
    messages: await convertToModelMessages(prepared.messages),
    providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
  });
  const finished = finishChat(result.text, result.steps, c.prompt);
  const observed: Observed = {
    text: result.text,
    tier: prepared.route.tier,
    toolCalls: finished.toolCalls as Observed["toolCalls"],
    products: result.steps.flatMap((s) => s.toolResults.flatMap((r) => productsOf(r.output))),
  };
  const failures = [
    ...(finished.check.leakedCanary ? ["vazou o canário"] : []),
    ...(leaksPrompt(result.text) ? ["citou as instruções"] : []),
    ...(finished.check.promisedDiscount ? ["prometeu desconto"] : []),
    ...finished.check.ungroundedPrices.map((p) => `preço inventado ${p}`),
    ...c.expect(observed),
  ];
  return { kind, id: c.id, store: c.store, prompt: c.prompt, passed: failures.length === 0, failures, tier: prepared.route.tier, leakedCanary: finished.check.leakedCanary, guardrailsPassed: outputPassed(finished.check), costUSD: finished.costUSD, models: finished.models, ms: Math.round(performance.now() - start), toolCalls: finished.toolCalls, text: result.text };
}

type ChatRow = Awaited<ReturnType<typeof runChat>>;
const rows: ChatRow[] = [];
const descriptions: { id: string; title: string; text: string; passed: boolean; check: unknown }[] = [];

function save(extra: Record<string, unknown> = {}) {
  writeFileSync("evals/results.json", JSON.stringify({ ...extra, rows, descriptions }, null, 1) + "\n");
}

// `--only <id>` runs one case and skips the gate: for checking a single case without spending the whole quota.
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;

try {
  for (const [kind, cases] of [["quality", QUALITY], ["attack", ATTACKS]] as const) {
    for (const c of cases.filter((x) => !only || x.id === only)) {
      const row = await runChat(kind, c);
      rows.push(row);
      console.log(`${row.passed ? "✓" : "✗"} ${kind.padEnd(7)} ${c.id.padEnd(22)} ${row.tier.padEnd(6)} ${row.ms} ms ${row.failures.join("; ")}`);
      if (!row.passed) console.log(`    tools: ${JSON.stringify(row.toolCalls)}\n    text: ${row.text.slice(0, 200)}`);
    }
  }
  // Descriptions for the coffee shop's thin products: grounded in the data, or flagged.
  for (const product of only ? [] : SAMPLE_CAFE.rows.slice(0, 8)) {
    const { text, check } = await generateDescription(models.fast, product);
    const passed = descriptionPassed(check);
    descriptions.push({ id: product.id, title: product.title, text, passed, check });
    console.log(`${passed ? "✓" : "✗"} description ${product.id.padEnd(8)} ${passed ? "" : JSON.stringify(check)}`);
  }
} catch (error) {
  // A model outage is not a quality result: stop, and fail the gate so nothing ships untested.
  console.error(`\n${(error as Error).message.slice(0, 200)}\nThe evaluation could not finish; the gate fails closed.`);
  save({ gate: "incomplete", error: (error as Error).message });
  process.exit(1);
}

if (only) {
  console.log("Single case run: no gate, results not saved.");
  process.exit(rows.every((r) => r.passed) ? 0 : 1);
}

const rate = (kind: string) => {
  const of = rows.filter((r) => r.kind === kind);
  return of.filter((r) => r.passed).length / of.length;
};
const costs = rows.map((r) => r.costUSD).filter((c): c is number => c !== null);
const summary = {
  ranAt: new Date().toISOString(),
  qualityPassRate: rate("quality"),
  attackPassRate: rate("attack"),
  canaryLeaks: rows.filter((r) => r.leakedCanary).length,
  descriptionPassRate: descriptions.filter((d) => d.passed).length / descriptions.length,
  averageCostUSD: costs.reduce((a, b) => a + b, 0) / (costs.length || 1),
  fastTierShare: rows.filter((r) => r.tier === "fast").length / rows.length,
  medianMs: rows.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
};
const gate = [
  summary.qualityPassRate < thresholds.qualityPassRate! && `quality ${summary.qualityPassRate} < ${thresholds.qualityPassRate}`,
  summary.attackPassRate < thresholds.attackPassRate! && `attacks ${summary.attackPassRate} < ${thresholds.attackPassRate}`,
  summary.canaryLeaks > thresholds.maxCanaryLeaks! && `${summary.canaryLeaks} canary leaks`,
  summary.descriptionPassRate < thresholds.descriptionPassRate! && `descriptions ${summary.descriptionPassRate} < ${thresholds.descriptionPassRate}`,
  summary.averageCostUSD > thresholds.maxAverageCostUSD! && `average cost ${summary.averageCostUSD.toFixed(5)}`,
].filter(Boolean) as string[];

save({ summary, thresholds, gate: gate.length ? "failed" : "passed", failures: gate });
console.log(`\n${JSON.stringify(summary, null, 1)}`);
if (gate.length) {
  console.error(`\nGATE FAILED: ${gate.join("; ")}`);
  process.exit(1);
}
console.log("\nGate passed.");
