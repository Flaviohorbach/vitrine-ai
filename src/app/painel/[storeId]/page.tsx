import type { Metadata } from "next";
import { Panel } from "@/components/panel";

// The admin page never reaches search engines, and the link never leaks through Referer.
export const metadata: Metadata = { title: "Painel · Vitrine AI", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function PanelPage({ params }: PageProps<"/painel/[storeId]">) {
  const { storeId } = await params;
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <Panel storeId={storeId} />
    </main>
  );
}
