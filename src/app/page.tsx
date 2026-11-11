import Link from "next/link";
import { CreateStore } from "@/components/create-store";
import { DEMO_SLUG } from "@/lib/demo";

const FEATURES = [
  { title: "Busca que entende", text: "“Presente para quem ama café até 100 reais” encontra o que importa: a busca combina sentido e palavras, e o preço vira filtro exato." },
  { title: "Assistente de vendas", text: "Responde com produtos de verdade do seu catálogo, em cards e comparações. Não inventa preço, não dá desconto, não sai do assunto." },
  { title: "Descrições revisadas", text: "Para os produtos com pouca descrição, a IA sugere um texto com os dados que você já tem. Você aprova, edita ou rejeita." },
  { title: "Seu catálogo para agentes", text: "Cada loja ganha um servidor MCP próprio: agentes de IA como o Claude consultam seu catálogo com um token só seu." },
];

const STEPS = [
  ["Crie a loja", "Dê um nome. Você recebe um link secreto de administração, sem cadastro."],
  ["Envie o catálogo", "Uma planilha CSV com até 100 produtos, ou o catálogo de exemplo."],
  ["Compartilhe", "A vitrine com busca e assistente fica num endereço próprio, e o MCP, num token próprio."],
];

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <p className="text-sm font-medium text-accent">Vitrine AI</p>
      <h1 className="mt-1 max-w-3xl font-display text-4xl font-bold text-balance sm:text-5xl">IA de loja grande para loja pequena</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">
        Envie seu catálogo e ganhe busca que entende o cliente, um assistente de vendas que não inventa e um servidor para agentes de IA. Em minutos, de graça.
      </p>

      <div className="mt-8 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex flex-col gap-3">
          <Link href={`/loja/${DEMO_SLUG}`} className="rounded-2xl border border-accent bg-accent-soft p-5 hover:bg-surface">
            <span className="font-display text-lg font-semibold">Ver uma loja pronta →</span>
            <span className="mt-1 block text-sm text-muted">99 produtos de 21 categorias. Busque, pergunte à assistente e compare.</span>
          </Link>
          <ol className="grid gap-3 sm:grid-cols-3">
            {STEPS.map(([title, text], i) => (
              <li key={title} className="rounded-xl border border-line bg-surface p-4">
                <span className="font-display text-2xl font-semibold text-accent">{i + 1}</span>
                <p className="mt-1 font-medium">{title}</p>
                <p className="mt-1 text-sm text-muted">{text}</p>
              </li>
            ))}
          </ol>
        </div>
        <CreateStore />
      </div>

      <section aria-labelledby="features-title" className="mt-14">
        <h2 id="features-title" className="font-display text-2xl font-semibold">O que cada loja ganha</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-line bg-surface p-5">
              <h3 className="font-display text-lg font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="trust-title" className="mt-14 rounded-2xl border border-line bg-surface p-6">
        <h2 id="trust-title" className="font-display text-2xl font-semibold">Feito para não dar vexame</h2>
        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <li>Preços conferidos: a assistente só cita valores que vêm do catálogo.</li>
          <li>Dados pessoais (CPF, cartão, telefone) são ocultados antes de chegar à IA.</li>
          <li>Cada resposta tem um rastro público: modelo usado, tempo e custo.</li>
          <li>Toda mudança passa por uma avaliação automática antes de ir ao ar.</li>
        </ul>
      </section>

      <footer className="mt-14 border-t border-line pt-4 text-sm text-muted">
        Projeto de portfólio que junta os 11 projetos anteriores de uma trilha de engenharia de IA.{" "}
        <a href="https://github.com/Flaviohorbach/vitrine-ai" className="text-accent underline">Código no GitHub</a>.
      </footer>
    </main>
  );
}
