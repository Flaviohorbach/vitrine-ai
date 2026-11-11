import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Storefront } from "@/components/storefront";
import { categories } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { DEMO_SLUG, ensureDemoStore } from "@/lib/demo";
import { storeBySlug } from "@/lib/stores";

export const dynamic = "force-dynamic";

async function load(slug: string) {
  const db = await getDb();
  await ensureDemoStore(db);
  const store = await storeBySlug(db, slug);
  return store ? { store, categories: await categories(db, store.id) } : null;
}

export async function generateMetadata({ params }: PageProps<"/loja/[slug]">): Promise<Metadata> {
  const data = await load((await params).slug);
  return { title: data ? `${data.store.name} · Vitrine AI` : "Loja não encontrada" };
}

const SUGGESTIONS: Record<string, string[]> = {
  [DEMO_SLUG]: ["Um presente para quem gosta de cozinhar", "Compare os notebooks mais caros", "Perfume feminino até R$ 400"],
};
const DEFAULT_SUGGESTIONS = ["O que vocês têm para presente?", "Qual é o mais vendido da loja?", "O que cabe em R$ 100?"];

export default async function StorePage({ params }: PageProps<"/loja/[slug]">) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-2xl font-bold">{data.store.name}</h1>
        <Link href="/" className="text-xs text-muted underline underline-offset-2">Feito com Vitrine AI</Link>
      </header>
      <Storefront slug={slug} storeName={data.store.name} categories={data.categories} suggestions={SUGGESTIONS[slug] ?? DEFAULT_SUGGESTIONS} />
    </main>
  );
}
