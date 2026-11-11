import type { Metadata } from "next";
import { Figtree, Outfit } from "next/font/google";
import "./globals.css";

const body = Figtree({ variable: "--font-body", subsets: ["latin"] });
const display = Outfit({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700"] });

export const metadata: Metadata = {
  title: "Vitrine AI · IA de loja grande para loja pequena",
  description: "Envie seu catálogo e ganhe busca semântica, assistente de vendas, descrições revisadas e um servidor MCP próprio.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${body.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
