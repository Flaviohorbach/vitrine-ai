/** Safe to import in the browser: no database, no model. */
export const formatBRL = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export interface PublicProduct {
  id: string;
  title: string;
  category: string;
  priceBRL: number;
  stock: number;
  imageUrl: string | null;
  description: string;
  attributes?: Record<string, string>;
}
