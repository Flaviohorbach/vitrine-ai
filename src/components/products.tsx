import { formatBRL, type PublicProduct } from "@/lib/format";

function Photo({ product, size }: { product: PublicProduct; size: "card" | "detail" }) {
  const box = size === "card" ? "h-36" : "h-48 sm:h-full sm:w-48";
  if (!product.imageUrl) {
    return (
      <div className={`${box} grid shrink-0 place-items-center rounded-lg bg-surface-2 font-display text-3xl font-semibold text-muted`} aria-hidden="true">
        {product.title.slice(0, 1)}
      </div>
    );
  }
  // Store photos come from any host, so a plain <img>: next/image would need every domain listed in advance.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={product.imageUrl} alt="" loading="lazy" className={`${box} w-full shrink-0 rounded-lg bg-surface-2 object-contain p-3`} />;
}

const Stock = ({ stock }: { stock: number }) =>
  stock > 0 ? <span className="text-xs text-ok">{stock <= 5 ? `Últimas ${stock} unidades` : "Em estoque"}</span> : <span className="text-xs text-danger">Esgotado</span>;

export function ProductCard({ product, onAsk }: { product: PublicProduct; onAsk?: (text: string) => void }) {
  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-line bg-surface p-3">
      <Photo product={product} size="card" />
      <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted">{product.category}</p>
      <h3 className="mt-0.5 line-clamp-2 text-sm font-medium">{product.title}</h3>
      <div className="mt-auto flex items-end justify-between gap-2 pt-2">
        <span className="font-display text-lg font-semibold text-price tabular-nums">{formatBRL(product.priceBRL)}</span>
        <Stock stock={product.stock} />
      </div>
      {onAsk && (
        <button type="button" onClick={() => onAsk(`Me fale mais sobre o produto ${product.id}: ${product.title}`)} className="mt-2 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent">
          Perguntar à assistente
        </button>
      )}
    </article>
  );
}

export function ProductGrid({ products, onAsk }: { products: PublicProduct[]; onAsk?: (text: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} onAsk={onAsk} />
      ))}
    </div>
  );
}

export function ProductRow({ products }: { products: PublicProduct[] }) {
  return (
    <div className="flex snap-x gap-3 overflow-x-auto pb-2">
      {products.map((p) => (
        <div key={p.id} className="w-44 shrink-0 snap-start">
          <ProductCard product={p} />
        </div>
      ))}
    </div>
  );
}

export function ComparisonTable({ products }: { products: PublicProduct[] }) {
  const cheapest = Math.min(...products.map((p) => p.priceBRL));
  const keys = [...new Set(products.flatMap((p) => Object.keys(p.attributes ?? {})))].slice(0, 6);
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full min-w-[28rem] border-collapse text-sm">
        <caption className="sr-only">Comparação de produtos</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="p-3 text-left text-xs font-medium text-muted">Produto</th>
            {products.map((p) => (
              <th key={p.id} scope="col" className="p-3 text-left font-medium">{p.title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line">
            <th scope="row" className="p-3 text-left text-xs font-medium text-muted">Preço</th>
            {products.map((p) => (
              <td key={p.id} className={`p-3 tabular-nums ${p.priceBRL === cheapest ? "font-semibold text-ok" : ""}`}>{formatBRL(p.priceBRL)}</td>
            ))}
          </tr>
          <tr className="border-b border-line">
            <th scope="row" className="p-3 text-left text-xs font-medium text-muted">Estoque</th>
            {products.map((p) => (
              <td key={p.id} className="p-3"><Stock stock={p.stock} /></td>
            ))}
          </tr>
          {keys.map((k) => (
            <tr key={k} className="border-b border-line last:border-0">
              <th scope="row" className="p-3 text-left text-xs font-medium capitalize text-muted">{k}</th>
              {products.map((p) => (
                <td key={p.id} className="p-3">{p.attributes?.[k] ?? "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProductDetail({ product }: { product: PublicProduct }) {
  const attributes = Object.entries(product.attributes ?? {});
  return (
    <article className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:flex-row">
      <Photo product={product} size="detail" />
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{product.category}</p>
        <h3 className="font-display text-lg font-semibold">{product.title}</h3>
        <p className="mt-1 font-display text-2xl font-semibold text-price tabular-nums">{formatBRL(product.priceBRL)}</p>
        <Stock stock={product.stock} />
        {product.description && <p className="mt-2 text-sm leading-relaxed">{product.description}</p>}
        {attributes.length > 0 && (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            {attributes.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="capitalize text-muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </article>
  );
}
