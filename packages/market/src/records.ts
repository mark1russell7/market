import { quantitySchema } from "@mark1russell7/quantity/schema";
import { z } from "zod";
import { parseGtin } from "./gtin.ts";

/**
 * The conditions of an offer. A source maps its own condition to one of them, and it keeps its own text in
 * the field `grade` of the offer.
 */
export const CONDITIONS = ["new", "open-box", "refurbished", "used", "for-parts", "unknown"] as const;
/** The condition of an offer. */
export type Condition = (typeof CONDITIONS)[number];

/** The states of the stock of an offer at the time of a reading. */
export const AVAILABILITIES = ["in-stock", "low-stock", "out-of-stock", "preorder", "unknown"] as const;
/** The state of the stock of an offer. */
export type Availability = (typeof AVAILABILITIES)[number];

/** The buying formats of an offer. In an auction, the price of a reading is the current bid. */
export const FORMATS = ["fixed-price", "auction"] as const;
/** The buying format of an offer. */
export type Format = (typeof FORMATS)[number];

/** This schema accepts a text with a character that is not a space, and with no space at an end. */
export const textSchema = z
  .string()
  .refine((text) => text !== "" && text === text.trim(), "The text is empty, or it has a space at an end.");

/** This schema accepts the name of a source: small letters, digits and hyphens, with a letter first. */
export const sourceSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/, "The name of a source has small letters, digits and hyphens, with a letter first.");

/** This schema accepts a GTIN in its GTIN-14 form, with a correct check digit. `parseGtin` gives this form. */
export const gtinSchema = z
  .string()
  .refine((text) => /^\d{14}$/.test(text) && parseGtin(text) === text, "The GTIN is not a GTIN-14 with a correct check digit.");

/** This schema accepts an amount of money of zero or more, for example `{ "value": 129.99, "unit": "USD" }`. */
export const moneySchema = quantitySchema("money", { nonnegative: true });

/** This schema accepts an instant in UTC in the ISO 8601 form, for example `2026-11-12T18:00:00Z`. */
export const instantSchema = z.iso.datetime();

/** This schema accepts a part number of a maker. */
export const partNumberSchema = z.strictObject({ brand: textSchema, partNumber: textSchema });

/** This schema accepts one specification as text, for example `{ "name": "Capacity", "value": "1 TB" }`. */
export const specSchema = z.strictObject({ name: textSchema, value: textSchema });

/** This schema accepts a seller. A rating is the percent of good feedback and the count of the feedback. */
export const sellerSchema = z.strictObject({
  id: textSchema.optional(),
  name: textSchema.optional(),
  rating: z.strictObject({ percent: z.number().min(0).max(100), count: z.int().nonnegative() }).optional(),
});

/** This schema accepts a product: one thing that a person can buy, with its identifiers and its specifications. */
export const productSchema = z.strictObject({
  id: textSchema,
  title: textSchema,
  brand: textSchema.optional(),
  category: z.array(textSchema).optional(),
  gtins: z.array(gtinSchema),
  partNumbers: z.array(partNumberSchema),
  specs: z.array(specSchema),
});

/** This function gives the id of an offer: the name of its source, a colon, and the id at the source. */
export function offerId(source: string, sourceId: string): string {
  return `${source}:${sourceId}`;
}

/** This function gives the name of the source of an offer id: the text before the first colon. */
export function sourceOfOffer(id: string): string {
  const colon = id.indexOf(":");
  if (colon <= 0) throw new RangeError(`The offer id ${JSON.stringify(id)} has no source.`);
  return id.slice(0, colon);
}

/**
 * This schema accepts an offer: one product at one seller. The offer has the identifiers that the source gives.
 * `productId` names the product of the catalog after a match.
 */
export const offerSchema = z
  .strictObject({
    id: textSchema,
    source: sourceSchema,
    sourceId: textSchema,
    productId: textSchema.optional(),
    title: textSchema,
    url: z.url({ protocol: /^https$/ }).optional(),
    seller: sellerSchema,
    condition: z.enum(CONDITIONS),
    grade: textSchema.optional(),
    format: z.enum(FORMATS),
    endsAt: instantSchema.optional(),
    gtins: z.array(gtinSchema),
    partNumbers: z.array(partNumberSchema),
    specs: z.array(specSchema),
  })
  .refine((offer) => offer.id === offerId(offer.source, offer.sourceId), {
    message: "The id of an offer is its source and its source id, with a colon between them.",
    path: ["id"],
  });

/** This schema accepts the shipping of a reading. A calculated cost depends on the address of the buyer. */
export const shippingSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("free") }),
  z.strictObject({ kind: z.literal("fixed"), cost: moneySchema }),
  z.strictObject({ kind: z.literal("calculated") }),
  z.strictObject({ kind: z.literal("unknown") }),
]);

/** This schema accepts a price break: the unit price for an order of `quantity` units or more. */
export const priceBreakSchema = z.strictObject({ quantity: z.int().min(2), unitPrice: moneySchema });

/**
 * This schema accepts a price reading: the state of one offer at one instant. `price` is the unit price for an
 * order of `minimumQuantity` units, or of one unit. The quantities of the breaks increase, and each is more
 * than the minimum.
 */
export const priceReadingSchema = z
  .strictObject({
    offerId: textSchema,
    at: instantSchema,
    price: moneySchema,
    listPrice: moneySchema.optional(),
    shipping: shippingSchema,
    availability: z.enum(AVAILABILITIES),
    available: z.int().nonnegative().optional(),
    minimumQuantity: z.int().min(1).optional(),
    priceBreaks: z.array(priceBreakSchema).optional(),
  })
  .superRefine((reading, context) => {
    let last = reading.minimumQuantity ?? 1;
    for (const [index, entry] of (reading.priceBreaks ?? []).entries()) {
      if (entry.quantity <= last) {
        context.addIssue({
          code: "custom",
          message: `The break ${index} has the quantity ${entry.quantity}, which is not more than ${last}.`,
          path: ["priceBreaks", index, "quantity"],
        });
      }
      last = Math.max(last, entry.quantity);
    }
    const { availability, available } = reading;
    if (available === undefined || availability === "unknown" || availability === "preorder") return;
    if ((availability === "out-of-stock") !== (available === 0)) {
      context.addIssue({
        code: "custom",
        message: `The availability ${availability} does not agree with the count ${available}.`,
        path: ["available"],
      });
    }
  });

/** A product of the catalog. */
export type Product = z.infer<typeof productSchema>;
/** An offer of a seller. */
export type Offer = z.infer<typeof offerSchema>;
/** A price reading of an offer. */
export type PriceReading = z.infer<typeof priceReadingSchema>;
/** The shipping of a reading. */
export type Shipping = z.infer<typeof shippingSchema>;
/** A price break of a reading. */
export type PriceBreak = z.infer<typeof priceBreakSchema>;
/** A seller of an offer. */
export type Seller = z.infer<typeof sellerSchema>;
