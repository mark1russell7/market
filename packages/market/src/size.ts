/**
 * The size of an item from the text of a seller, for example `16.9 fl oz`, `24 ct` or `24 ct / 16.9 fl oz`. A price
 * reading of an item sold by unit gives the price of the whole item. The amount of the size divides the price into a
 * price for each unit of the amount (`amountPrice`). Thus a buy list compares items of different sizes.
 */
import { convert, convertible, divide, quantity, tryParseUnit, type Quantity } from "@mark1russell7/quantity";

/** The unit of a count of items in a pack. */
export const EACH_UNIT = "{each}";

/** The relative difference that two amounts of one size can have, for example `16 oz / 454 g`. */
const SAME_AMOUNT = 0.02;

/** The spellings of the sellers for the units of quantity. A spelling that is not here goes to `tryParseUnit`. */
const SPELLINGS: Readonly<Record<string, string>> = {
  ct: EACH_UNIT,
  count: EACH_UNIT,
  ea: EACH_UNIT,
  each: EACH_UNIT,
  pk: EACH_UNIT,
  pack: EACH_UNIT,
  pc: EACH_UNIT,
  pcs: EACH_UNIT,
  oz: "oz",
  "fl oz": "fl oz",
  floz: "fl oz",
  lb: "lb",
  lbs: "lb",
  g: "g",
  kg: "kg",
  mg: "mg",
  ml: "mL",
  l: "L",
  ltr: "L",
  gal: "gal",
  qt: "qt",
  pt: "pt",
};

/** The size of an item that is read: the whole amount, and for a pack the count and the amount of each. */
export interface ReadSize {
  readonly ok: true;
  /** The whole amount of the item, in a unit of mass, of volume or of a count (`{each}`). */
  readonly amount: Quantity;
  /** The count of the pack, for `24 ct / 16.9 fl oz` or `6 x 8 oz`. */
  readonly count?: number | undefined;
  /** The amount of each item of the pack. */
  readonly each?: Quantity | undefined;
}

/** A size that is not read, with the reason. */
export interface UnreadSize {
  readonly ok: false;
  readonly why: string;
}

/** The size of an item: read or not read. */
export type Size = ReadSize | UnreadSize;

/** This function gives the unit of a spelling of a seller, or undefined. The unit is a mass, a volume or a count. */
function unitOf(spelling: string): string | undefined {
  const text = spelling.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  const unit = SPELLINGS[text] ?? tryParseUnit(spelling)?.symbol;
  if (unit === undefined) return undefined;
  return unit === EACH_UNIT || convertible(unit, "kg") || convertible(unit, "L") ? unit : undefined;
}

/** This function reads one amount, for example `16.9 fl oz` or `24 ct`. */
function amountOf(text: string): Quantity | undefined {
  const match = /^(\d+(?:\.\d+)?|\.\d+)\s*([^\d\s].*)$/.exec(text.trim());
  if (match === null) return undefined;
  const value = Number(match[1]);
  const unit = unitOf(match[2] ?? "");
  return unit === undefined || !(value > 0) ? undefined : quantity(value, unit);
}

/** This function gives the amount of a pack of `count` items of the amount `each`. */
function pack(count: Quantity, each: Quantity): ReadSize {
  return { ok: true, amount: quantity(count.value * each.value, each.unit), count: count.value, each };
}

/**
 * This function reads the size of an item from the text of a seller.
 *
 * - One amount: `16.9 fl oz`, `5 lb`, `500 mL`, `1 gal` or `24 ct`. A count has the unit `{each}`.
 * - A pack: `24 ct / 16.9 fl oz` or `6 x 8 oz`. The amount is the count times the amount of each.
 * - Two amounts of one size: `16 oz / 454 g`. The amount is the first. The two must agree to 2%.
 * - The units are a mass, a volume or a count. `oz` is a mass, and `fl oz` is a volume.
 *
 * @param text - The size text, for example `24 ct / 16.9 fl oz`
 * @returns The size, or a size that is not read with the reason
 */
export function parseSize(text: string): Size {
  const refused = (why: string): UnreadSize => ({ ok: false, why: `The size ${JSON.stringify(text)} is not read: ${why}.` });
  // Each quantifier ends at a character that the next part does not match. Thus the match takes linear time.
  const times = /^(\d+)\s*[x×]\s*(\S.*)$/i.exec(text.trim());
  if (times !== null) {
    const each = amountOf(times[2] ?? "");
    const count = Number(times[1]);
    if (each === undefined || !(count > 0)) return refused("the amount after the count is not an amount");
    return pack(quantity(count, EACH_UNIT), each);
  }
  const parts = text.split("/");
  if (parts.length > 2) return refused("it has more than two parts");
  const amounts = parts.map(amountOf);
  const [first, second] = amounts;
  if (first === undefined || (parts.length === 2 && second === undefined)) return refused("a part is not an amount with a unit of mass, volume or count");
  if (second === undefined) return { ok: true, amount: first };
  const firstCount = first.unit === EACH_UNIT;
  const secondCount = second.unit === EACH_UNIT;
  if (firstCount && secondCount) return refused("both parts are counts");
  if (firstCount || secondCount) return firstCount ? pack(first, second) : pack(second, first);
  if (!convertible(second.unit, first.unit)) return refused("the two amounts are a mass and a volume");
  const other = convert(second, first.unit).value;
  if (Math.abs(other - first.value) > SAME_AMOUNT * first.value) return refused("the two amounts do not agree");
  return { ok: true, amount: first };
}

/**
 * This function gives the price for each unit of the amount of a size, for example `USD/fl oz`.
 *
 * @param price - The price of the whole item
 * @param size - The size of the item that is read
 * @returns The price divided by the amount of the size
 */
export function sizePrice(price: Quantity, size: ReadSize): Quantity {
  return divide(price, size.amount);
}
