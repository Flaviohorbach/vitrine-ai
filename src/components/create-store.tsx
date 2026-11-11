"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function CreateStore() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [sample, setSample] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/stores", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, sample }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível criar a loja.");
      // The token goes in the fragment: browsers never send it to the server or in Referer.
      router.push(`/painel/${body.id}#${body.adminToken}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-line bg-surface p-5">
      <label htmlFor="store-name" className="text-sm font-medium">Nome da sua loja</label>
      <input id="store-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} placeholder="Ex.: Café da Serra" className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2" />
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} className="mt-1" />
        <span>Começar com o catálogo de exemplo de uma cafeteria (25 produtos). Dá para trocar por um CSV depois.</span>
      </label>
      <button type="submit" disabled={busy} className="mt-4 w-full rounded-full bg-accent px-5 py-3 font-medium text-accent-ink disabled:opacity-60">
        {busy ? "Criando…" : "Criar minha loja grátis"}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <p className="mt-3 text-xs text-muted">Sem cadastro: você recebe um link secreto de administração. Lojas de teste sem uso por 7 dias são apagadas.</p>
    </form>
  );
}
