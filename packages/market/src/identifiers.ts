import { parseGtin } from "./gtin.ts";

/** A part number of a maker: the brand, and the number that the maker gives to the part. */
export interface PartNumber {
  readonly brand: string;
  readonly partNumber: string;
}

/** The identifiers of a product or of an offer. */
export interface Identifiers {
  readonly gtins: readonly string[];
  readonly partNumbers: readonly PartNumber[];
}

/**
 * This function folds a brand or a part number for a comparison. The result has only capital letters A to Z
 * and digits. Thus `MZ-V8V1T0B/AM` and `mzv8v1t0bam` fold to one text.
 */
export function foldCode(text: string): string {
  return text.normalize("NFKD").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * This function gives the match keys of a record, sorted and with no copy. A key is `gtin:` with the GTIN-14,
 * or `part:` with the folded brand and part number. Two records with a key in common name one product.
 * The function ignores a GTIN that is not valid, and a part number whose brand or number folds to no text.
 */
export function matchKeys(identifiers: Identifiers): string[] {
  const keys = new Set<string>();
  for (const text of identifiers.gtins) {
    const gtin = parseGtin(text);
    if (gtin !== null) keys.add(`gtin:${gtin}`);
  }
  for (const { brand, partNumber } of identifiers.partNumbers) {
    const folded = [foldCode(brand), foldCode(partNumber)];
    if (folded.every((part) => part !== "")) keys.add(`part:${folded.join("/")}`);
  }
  return [...keys].sort();
}
