/**
 * The records of the market: a product, an offer of a seller and a price reading, with their checks. The module
 * also has the GTIN check, the match keys of a record, the cost of an order and the storage rules of a source.
 */
export { gtinCheckDigit, parseGtin } from "./gtin.ts";
export { foldCode, matchKeys, type Identifiers, type PartNumber } from "./identifiers.ts";
export { costOf, unitPriceFor } from "./price.ts";
export {
  AVAILABILITIES,
  CONDITIONS,
  FORMATS,
  gtinSchema,
  instantSchema,
  moneySchema,
  offerId,
  offerSchema,
  partNumberSchema,
  priceBreakSchema,
  priceReadingSchema,
  productSchema,
  sellerSchema,
  shippingSchema,
  sourceOfOffer,
  sourceSchema,
  specSchema,
  textSchema,
  type Availability,
  type Condition,
  type Format,
  type Offer,
  type PriceBreak,
  type PriceReading,
  type Product,
  type Seller,
  type Shipping,
} from "./records.ts";
export {
  isKept,
  keepUntil,
  permitsHistory,
  permitsTrend,
  retentionSchema,
  sourceTermsSchema,
  type Retention,
  type SourceTerms,
} from "./terms.ts";
