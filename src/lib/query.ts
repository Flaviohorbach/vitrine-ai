// From project 6 (semantic-catalog-search), unchanged.
/** Lowercase, no accents: "Tênis" and "tenis" must be the same word for keyword search. */
export const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

export interface ParsedQuery {
  /** The query without the price phrase: what actually gets searched. */
  text: string;
  minPrice: number | null;
  maxPrice: number | null;
}

const NUMBER = String.raw`(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?(\s*mil\b)?`;
const CURRENCY = String.raw`(?:r\$\s*)?`;
const UNIT = String.raw`(\s*(?:reais|real|conto|contos|pila)\b)?`;
const AFTER = String.raw`(?=\s*(?:[.,;!?]|$))`;

const toValue = (digits: string, thousand?: string) => Number(digits.replaceAll(".", "")) * (thousand ? 1000 : 1);

/**
 * "até 400" is a price, "até 4 pessoas" is not. A number counts as a price when
 * it carries a currency marker (R$, reais, mil) or ends the phrase; a number
 * followed by another word describes something else and stays in the query.
 */
function isPrice(match: RegExpExecArray, currencyIndex: number, thousandIndex: number): boolean {
  const hasMarker = match[0].includes("r$") || Boolean(match[currencyIndex]) || Boolean(match[thousandIndex]);
  if (hasMarker) return true;
  const rest = match.input.slice(match.index + match[0].length);
  return new RegExp(`^${AFTER}`).test(rest);
}

/**
 * Takes the price out of the query. It becomes a SQL filter, which is exact:
 * embeddings are bad at numbers, and "até 400 reais" should not influence the
 * meaning of "tênis para correr". Deterministic and free: no model call.
 */
export function parseQuery(raw: string): ParsedQuery {
  let text = normalize(raw);
  let minPrice: number | null = null;
  let maxPrice: number | null = null;

  const between = new RegExp(String.raw`\b(?:entre|de)\s+${CURRENCY}${NUMBER}\s+(?:e|a)\s+${CURRENCY}${NUMBER}${UNIT}`).exec(text);
  if (between && (between[0].includes("r$") || between[2] || between[4] || between[5] || between[0].startsWith("entre"))) {
    minPrice = toValue(between[1]!, between[2]);
    maxPrice = toValue(between[3]!, between[4]);
    text = text.replace(between[0], " ");
  }

  const upper = new RegExp(String.raw`\b(?:por\s+)?(?:ate|abaixo\s+de|menos\s+de|no\s+maximo|max\.?|custando\s+ate)\s+${CURRENCY}${NUMBER}${UNIT}`).exec(text);
  if (upper && maxPrice === null && isPrice(upper, 3, 2)) {
    maxPrice = toValue(upper[1]!, upper[2]);
    text = text.replace(upper[0], " ");
  }

  const lower = new RegExp(String.raw`\b(?:acima\s+de|mais\s+de|a\s+partir\s+de)\s+${CURRENCY}${NUMBER}${UNIT}`).exec(text);
  if (lower && minPrice === null && isPrice(lower, 3, 2)) {
    minPrice = toValue(lower[1]!, lower[2]);
    text = text.replace(lower[0], " ");
  }

  return { text: text.replace(/\s+/g, " ").replace(/\s+([.,;!?])/g, "$1").trim(), minPrice, maxPrice };
}

/**
 * Words for a Postgres OR query. Only letters and digits survive, so nothing
 * typed by a visitor can reach to_tsquery as syntax (`&`, `:*`, `!`).
 */
export function queryTerms(text: string): string[] {
  return [...new Set(normalize(text).match(/[a-z0-9]+/g) ?? [])];
}
