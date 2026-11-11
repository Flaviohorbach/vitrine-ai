"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { formatBRL, type PublicProduct } from "@/lib/format";
import type { ChatMetadata, ShopUIMessage } from "@/lib/tools";
import { ComparisonTable, ProductDetail, ProductGrid, ProductRow } from "./products";

interface SearchResponse {
  products: PublicProduct[];
  filters: { minPrice: number | null; maxPrice: number | null; category: string | null };
  semantic: boolean;
}

const usd = (v: number) => `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 5, maximumFractionDigits: 5 })}`;

/** How the answer was made: the production side, visible (project 11). */
function AnswerInfo({ info }: { info: ChatMetadata }) {
  const items = [
    info.tier && `${info.tier === "fast" ? "Modelo rápido" : "Modelo forte"} (${info.routeReason})`,
    info.costUSD != null ? `${usd(info.costUSD)} pelo preço pago` : null,
    info.ms != null ? `${(info.ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s` : null,
  ].filter(Boolean);
  if (!items.length) return null;
  return (
    <p className="flex flex-wrap gap-x-2 text-xs text-muted">
      {items.join(" · ")}
      {info.maskedData?.length ? <span className="text-warn">· dados pessoais ocultados</span> : null}
      {info.traceUrl && (
        <a href={info.traceUrl} target="_blank" rel="noreferrer" className="font-medium text-accent underline underline-offset-2">
          Ver o trace
        </a>
      )}
    </p>
  );
}

function Part({ part }: { part: ShopUIMessage["parts"][number] }) {
  switch (part.type) {
    case "text":
      return part.text ? <p className="leading-relaxed whitespace-pre-wrap">{part.text}</p> : null;
    case "tool-searchProducts":
      if (part.state === "output-available") return part.output.products.length ? <ProductRow products={part.output.products} /> : <p className="text-sm text-muted">Nenhum produto encontrado.</p>;
      return <p className="text-sm text-muted" role="status">Buscando…</p>;
    case "tool-compareProducts":
      if (part.state === "output-available") return <ComparisonTable products={part.output.products} />;
      return <p className="text-sm text-muted" role="status">Montando a comparação…</p>;
    case "tool-getProductDetails":
      if (part.state === "output-available") return "product" in part.output && part.output.product ? <ProductDetail product={part.output.product} /> : <p className="text-sm text-danger">Produto não encontrado.</p>;
      return <p className="text-sm text-muted" role="status">Abrindo o produto…</p>;
    default:
      return null;
  }
}

export function Storefront({ slug, storeName, categories, suggestions }: { slug: string; storeName: string; categories: string[]; suggestions: string[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [input, setInput] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error, stop } = useChat<ShopUIMessage>({
    transport: new DefaultChatTransport({ api: `/api/s/${slug}/chat` }),
  });
  const busy = status === "submitted" || status === "streaming";

  // Debounced search: one request after the visitor stops typing, not one per key.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ q: query });
        if (category) params.set("categoria", category);
        const response = await fetch(`/api/s/${slug}/search?${params}`, { signal: controller.signal });
        if (response.ok) setResult(await response.json());
      } catch {
        // aborted by a newer search
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, category, slug]);

  // Braces matter: scrollIntoView returns a Promise in newer browsers, and an effect must return nothing or a cleanup.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const ask = useCallback(
    (text: string) => {
      setChatOpen(true);
      sendMessage({ text });
    },
    [sendMessage],
  );

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim() || busy) return;
    ask(input.trim());
    setInput("");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <section aria-labelledby="catalog-title" className="min-w-0">
        <h2 id="catalog-title" className="sr-only">Catálogo</h2>
        <label htmlFor="search" className="sr-only">Buscar produtos</label>
        <input
          id="search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Busque do seu jeito: “presente para quem ama café até 100 reais”"
          className="w-full rounded-full border border-line bg-surface px-5 py-3 placeholder:text-muted"
        />
        {/* One scrolling row on phones, so the products are not pushed below the fold. */}
        <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {[null, ...categories].map((c) => (
            <button key={c ?? "todas"} type="button" aria-pressed={category === c} onClick={() => setCategory(c)} className="shrink-0 rounded-full border border-line px-3 py-1 text-sm whitespace-nowrap aria-pressed:border-accent aria-pressed:bg-accent-soft">
              {c ?? "Todas"}
            </button>
          ))}
        </div>
        <p className="mt-3 min-h-5 text-xs text-muted" aria-live="polite">
          {searching
            ? "Buscando…"
            : result && (
                <>
                  {result.products.length} {result.products.length === 1 ? "produto" : "produtos"}
                  {result.filters.maxPrice !== null && ` até ${formatBRL(result.filters.maxPrice)}`}
                  {result.filters.minPrice !== null && ` a partir de ${formatBRL(result.filters.minPrice)}`}
                  {query && !result.semantic && " · busca só por palavras agora"}
                </>
              )}
        </p>
        {result && <ProductGrid products={result.products} onAsk={ask} />}
      </section>

      <aside aria-labelledby="assistant-title" className={`min-w-0 ${chatOpen ? "" : "max-lg:hidden"}`}>
        <div className="flex max-h-[80vh] flex-col rounded-2xl border border-line bg-surface lg:sticky lg:top-4">
          <div className="flex items-center justify-between border-b border-line p-4">
            <h2 id="assistant-title" className="font-display font-semibold">Assistente da {storeName}</h2>
            <button type="button" onClick={() => setChatOpen(false)} className="text-sm text-muted lg:hidden">Fechar</button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted">Pergunte como perguntaria a um vendedor.</p>
                {suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)} className="rounded-lg border border-line px-3 py-2 text-left text-sm hover:border-accent">
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m) =>
              m.role === "user" ? (
                <p key={m.id} className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-accent px-3 py-2 text-sm text-accent-ink">
                  {m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}
                </p>
              ) : (
                <div key={m.id} className="flex min-w-0 flex-col gap-3 text-sm">
                  {m.parts.map((p, i) => (
                    <Part key={i} part={p} />
                  ))}
                  {m.metadata && <AnswerInfo info={m.metadata} />}
                </div>
              ),
            )}
            {status === "submitted" && <p className="text-sm text-muted" role="status">Pensando…</p>}
            {error && <p role="alert" className="text-sm text-danger">{error.message || "Não foi possível responder agora."}</p>}
            <div ref={endRef} />
          </div>
          <form onSubmit={onSubmit} className="flex gap-2 border-t border-line p-3">
            <label htmlFor="chat-input" className="sr-only">Mensagem para a assistente</label>
            <input id="chat-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Escreva sua pergunta" autoComplete="off" className="min-w-0 flex-1 rounded-full border border-line bg-bg px-4 py-2 text-sm" />
            {busy ? (
              <button type="button" onClick={() => stop()} className="rounded-full border border-line px-4 py-2 text-sm">Parar</button>
            ) : (
              <button type="submit" className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink">Enviar</button>
            )}
          </form>
        </div>
      </aside>

      {!chatOpen && (
        <button type="button" onClick={() => setChatOpen(true)} className="fixed right-4 bottom-4 rounded-full bg-accent px-5 py-3 font-medium text-accent-ink shadow-lg lg:hidden">
          Falar com a assistente
        </button>
      )}
    </div>
  );
}
