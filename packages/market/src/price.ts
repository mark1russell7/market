import { add, scale, type Quantity } from "@mark1russell7/quantity";
import type { PriceReading } from "./records.ts";

/**
 * This function gives the unit price for an order of `count` units. The price of the largest break at or
 * below the count applies, or the price of the reading when no break applies.
 *
 * @throws RangeError when the count is not a whole number, or when it is less than the minimum of the reading.
 */
export function unitPriceFor(reading: PriceReading, count: number): Quantity {
  const minimum = reading.minimumQuantity ?? 1;
  if (!Number.isSafeInteger(count) || count < minimum) {
    throw new RangeError(`The count ${count} is not a whole number of ${minimum} or more.`);
  }
  let price: Quantity = reading.price;
  for (const entry of reading.priceBreaks ?? []) if (entry.quantity <= count) price = entry.unitPrice;
  return price;
}

/**
 * This function gives the cost of an order of `count` units with its shipping, or null when the shipping
 * cost is not known. The cost is exact, and the function does not round it to the cent.
 *
 * @throws RangeError when the count is not a whole number, or when it is less than the minimum of the reading.
 */
export function costOf(reading: PriceReading, count: number): Quantity | null {
  const goods = scale(unitPriceFor(reading, count), count);
  switch (reading.shipping.kind) {
    case "free":
      return goods;
    case "fixed":
      return add(goods, reading.shipping.cost);
    default:
      return null;
  }
}
