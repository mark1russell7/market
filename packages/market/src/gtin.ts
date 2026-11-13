/**
 * This module reads the GTIN of a product: a GTIN-8, a UPC-A (12 digits), an EAN-13 or a GTIN-14.
 * The last digit is a check digit. The sum of the other digits, with the weights 3 and 1 from the right, gives it.
 */

const LENGTHS: ReadonlySet<number> = new Set([8, 12, 13, 14]);

/**
 * This function gives the check digit of the digits of a GTIN without its last digit.
 *
 * @throws RangeError when the text has a character that is not a digit, or no character.
 */
export function gtinCheckDigit(body: string): number {
  if (!/^\d+$/.test(body)) throw new RangeError(`The text ${JSON.stringify(body)} is not a string of digits.`);
  let total = 0;
  for (let i = 0; i < body.length; i += 1) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    total += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (total % 10)) % 10;
}

/**
 * This function gives the GTIN-14 form of a GTIN, or null. It removes the spaces and the hyphens first.
 * It refuses a length other than 8, 12, 13 or 14 digits, a wrong check digit, and a GTIN of zeros only.
 */
export function parseGtin(text: string): string | null {
  const digits = text.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits) || !LENGTHS.has(digits.length) || /^0+$/.test(digits)) return null;
  if (gtinCheckDigit(digits.slice(0, -1)) !== Number(digits.slice(-1))) return null;
  return digits.padStart(14, "0");
}
