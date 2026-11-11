"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatBRL } from "@/lib/format";

interface PanelProduct {
  id: string;
  title: string;
  description: string;
  category: string;
  priceBRL: number;
  stock: number;
  suggestedDescription: string | null;
  descriptionStatus: "none" | "pending" | "approved" | "rejected";
}

interface PanelData {
  store: { id: string; slug: string; name: string; isDemo: boolean };
  products: PanelProduct[];
  categories: string[];
  pendingEmbeddings: number;
  thinDescriptions: number;
  usage: Record<string, number>;
  limits: { maxProducts: number; chat: number; descriptions: number };
}

interface Check {
  inventedNumbers: string[];
  unsupportedClaims: string[];
}

const TABS = ["Catálogo", "Descrições", "Conectar agentes", "Uso"] as const;

export function Panel({ storeId }: { storeId: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<PanelData | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Catálogo");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [mcpToken, setMcpToken] = useState<string | null>(null);

  // The admin token lives in the URL fragment, which browsers never send to the server.
  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the fragment once, on mount
    setToken(fromHash || null);
  }, []);

  const api = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const response = await fetch(`/api/admin/${storeId}${path}`, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...init.headers } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Algo deu errado.");
      return body;
    },
    [storeId, token],
  );

  const load = useCallback(async () => {
    try {
      setData(await api(""));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading once the token is known
    if (token) void load();
  }, [token, load]);

  // Embeddings in batches, about a minute apart: the free tier embeds 100 texts a minute.
  const pending = data?.pendingEmbeddings ?? 0;
  useEffect(() => {
    if (!token || pending === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const step = async () => {
      try {
        const result = await api("/embeddings", { method: "POST" });
        if (cancelled) return;
        setData((d) => (d ? { ...d, pendingEmbeddings: result.pending } : d));
        if (result.pending > 0) timer = setTimeout(step, (result.retryInSeconds ?? 61) * 1000);
      } catch {
        if (!cancelled) timer = setTimeout(step, 65_000);
      }
    };
    void step();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, pending > 0, api]); // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(file: File) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await api("/catalog", { method: "POST", body: JSON.stringify({ csv: await file.text() }) });
      setNotice(`${result.imported} produtos importados.${result.errors.length ? ` ${result.errors.length} linhas ignoradas: ${result.errors.map((e: { line: number; message: string }) => `linha ${e.line} (${e.message})`).slice(0, 5).join("; ")}` : ""}`);
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function suggest() {
    setBusy(true);
    setNotice(null);
    try {
      const result = await api("/descriptions", { method: "POST" });
      const fresh: Record<string, Check> = {};
      for (const g of result.generated ?? []) if (g.check) fresh[g.id] = g.check;
      setChecks((c) => ({ ...c, ...fresh }));
      setNotice(result.message ?? `${(result.generated ?? []).filter((g: { text?: string }) => g.text).length} sugestões geradas. Revise antes de aprovar.`);
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function review(id: string, decision: "approved" | "rejected") {
    try {
      await api(`/descriptions/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ decision, text: drafts[id] }) });
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  async function newMcpToken() {
    try {
      setMcpToken((await api("/mcp-token", { method: "POST" })).token);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  if (!token) return <p className="text-muted">Este painel abre pelo link de administração da loja, que inclui a chave depois do “#”.</p>;
  if (error) return <p role="alert" className="text-danger">{error}</p>;
  if (!data) return <p className="text-muted">Carregando…</p>;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const mcpUrl = `${origin}/api/mcp/${data.store.slug}`;
  const pendingReview = data.products.filter((p) => p.descriptionStatus === "pending");

  return (
    <div>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-accent">Painel da loja</p>
          <h1 className="font-display text-2xl font-bold">{data.store.name}</h1>
        </div>
        <Link href={`/loja/${data.store.slug}`} className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink">Abrir a vitrine</Link>
      </header>
      <p className="mt-3 rounded-lg border border-warn/40 bg-surface p-3 text-sm">
        <strong>Guarde o endereço desta página.</strong> Ele é a chave da loja: não há login nem recuperação. Lojas de teste sem uso por 7 dias são apagadas.
      </p>

      <nav className="mt-5 flex flex-wrap gap-1.5" aria-label="Seções do painel">
        {TABS.map((t) => (
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)} className="rounded-full border border-line px-3 py-1.5 text-sm aria-pressed:border-accent aria-pressed:bg-accent-soft">
            {t}
            {t === "Descrições" && pendingReview.length > 0 && <span className="ml-1.5 rounded-full bg-warn px-1.5 text-xs text-bg">{pendingReview.length}</span>}
          </button>
        ))}
      </nav>
      {notice && <p className="mt-3 text-sm" role="status">{notice}</p>}

      {tab === "Catálogo" && (
        <section className="mt-4" aria-label="Catálogo">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4">
            <label className="text-sm">
              <span className="font-medium">Trocar o catálogo por um CSV</span>
              <input type="file" accept=".csv,text/csv" disabled={busy || data.store.isDemo} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="mt-1 block text-sm" />
            </label>
            <p className="text-xs text-muted">
              Colunas: <code>sku, nome, descricao, categoria, preco, estoque, imagem, atributos</code> (atributos como <code>cor=preto; tamanho=M</code>). Até {data.limits.maxProducts} produtos.{" "}
              <a href="/exemplo-catalogo.csv" className="text-accent underline">Baixar um exemplo</a>
            </p>
          </div>
          {data.pendingEmbeddings > 0 && (
            <p className="mt-3 text-sm text-warn" role="status">
              Preparando a busca por sentido: faltam {data.pendingEmbeddings} produtos. Enquanto isso, a busca funciona por palavras. Deixe esta página aberta.
            </p>
          )}
          <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th scope="col" className="p-3 font-medium">Produto</th>
                  <th scope="col" className="p-3 font-medium">Categoria</th>
                  <th scope="col" className="p-3 font-medium">Preço</th>
                  <th scope="col" className="p-3 font-medium">Estoque</th>
                </tr>
              </thead>
              <tbody>
                {data.products.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="p-3">{p.title}</td>
                    <td className="p-3 text-muted">{p.category}</td>
                    <td className="p-3 tabular-nums">{formatBRL(p.priceBRL)}</td>
                    <td className="p-3 tabular-nums">{p.stock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "Descrições" && (
        <section className="mt-4" aria-label="Descrições">
          <div className="rounded-xl border border-line bg-surface p-4 text-sm">
            <p>
              {data.thinDescriptions} produtos têm descrição curta. A IA sugere um texto usando <strong>só os dados do produto</strong>; números e promessas que não estão nos dados são marcados. Nada vai para a vitrine sem a sua aprovação.
            </p>
            <button type="button" onClick={suggest} disabled={busy || data.store.isDemo || data.thinDescriptions === 0} className="mt-3 rounded-full bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-50">
              {busy ? "Gerando…" : "Sugerir 3 descrições"}
            </button>
            <p className="mt-2 text-xs text-muted">Usadas hoje: {data.usage.descriptions ?? 0} de {data.limits.descriptions}.</p>
          </div>
          <ul className="mt-3 space-y-3">
            {pendingReview.map((p) => {
              const check = checks[p.id];
              const flagged = check && (check.inventedNumbers.length || check.unsupportedClaims.length);
              return (
                <li key={p.id} className="rounded-xl border border-line bg-surface p-4 text-sm">
                  <p className="font-medium">{p.title}</p>
                  <p className="mt-1 text-xs text-muted">Hoje: “{p.description || "sem descrição"}”</p>
                  <label className="mt-2 block text-xs font-medium" htmlFor={`d-${p.id}`}>Sugestão (pode editar)</label>
                  <textarea id={`d-${p.id}`} rows={3} defaultValue={p.suggestedDescription ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))} className="mt-1 w-full rounded-lg border border-line bg-bg p-2" />
                  {flagged ? (
                    <p className="mt-1 text-xs text-warn">
                      Confira antes de aprovar: {[...check!.inventedNumbers.map((n) => `o número “${n}” não está nos dados`), ...check!.unsupportedClaims.map((c) => `“${c}” não está nos dados`)].join("; ")}.
                    </p>
                  ) : check ? (
                    <p className="mt-1 text-xs text-ok">Nenhum número ou promessa fora dos dados.</p>
                  ) : null}
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => review(p.id, "approved")} className="rounded-full bg-accent px-3 py-1.5 font-medium text-accent-ink">Aprovar</button>
                    <button type="button" onClick={() => review(p.id, "rejected")} className="rounded-full border border-line px-3 py-1.5">Rejeitar</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {tab === "Conectar agentes" && (
        <section className="mt-4 rounded-xl border border-line bg-surface p-4 text-sm" aria-label="Conectar agentes">
          <p>
            Esta loja tem um servidor <strong>MCP</strong> próprio: qualquer agente de IA compatível (Claude, Cursor e outros) pode buscar no seu catálogo, só para leitura.
          </p>
          <p className="mt-3 text-xs font-medium text-muted">Endereço</p>
          <code className="mt-1 block break-all rounded-lg bg-surface-2 p-2">{mcpUrl}</code>
          {data.store.isDemo ? (
            <p className="mt-3">Token público da demonstração: <code>mcp_demo_vitrine</code></p>
          ) : mcpToken ? (
            <>
              <p className="mt-3 text-xs font-medium text-muted">Token (aparece só agora: copie e guarde)</p>
              <code className="mt-1 block break-all rounded-lg bg-surface-2 p-2">{mcpToken}</code>
            </>
          ) : (
            <button type="button" onClick={newMcpToken} className="mt-3 rounded-full bg-accent px-4 py-2 font-medium text-accent-ink">Gerar token</button>
          )}
          <p className="mt-3 text-xs text-muted">Gerar um token novo desativa o anterior na hora.</p>
          <p className="mt-4 text-xs font-medium text-muted">Exemplo para o Claude Code</p>
          <code className="mt-1 block break-all rounded-lg bg-surface-2 p-2">{`claude mcp add --transport http ${data.store.slug} ${mcpUrl} --header "Authorization: Bearer ${mcpToken ?? (data.store.isDemo ? "mcp_demo_vitrine" : "<seu-token>")}"`}</code>
        </section>
      )}

      {tab === "Uso" && (
        <section className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Uso de hoje">
          {[
            ["Conversas com a assistente", data.usage.chat ?? 0, data.limits.chat],
            ["Descrições sugeridas", data.usage.descriptions ?? 0, data.limits.descriptions],
            ["Chamadas de agentes (MCP)", data.usage.mcp ?? 0, null],
          ].map(([label, used, limit]) => (
            <div key={label as string} className="rounded-xl border border-line bg-surface p-4">
              <p className="text-xs text-muted">{label}</p>
              <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
                {used as number}
                {limit !== null && <span className="text-base text-muted"> / {limit as number}</span>}
              </p>
            </div>
          ))}
          <p className="text-xs text-muted sm:col-span-3">Limites por dia, para dividir a cota gratuita entre as lojas de teste.</p>
        </section>
      )}
    </div>
  );
}
