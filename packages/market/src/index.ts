/**
 * The records of the market: a product, an offer of a seller and a price reading, with their checks. The module
 * also has the GTIN check, the match keys of a record, the cost of an order and the storage rules of a source.
 * The offers of a part and the best offer join the observations of the sources to the parts that a buyer wants.
 * The board keeps the current prices within the terms of each source, and plans the reads of a watch.
 */
export {
  BOARD_FORMAT,
  boardSchema,
  keepObservations,
  observationSchema,
  planReads,
  readInterval,
  watchEntrySchema,
  watchProblems,
  type Board,
  type Dropped,
  type KeepOptions,
  type Kept,
  type ReadInterval,
  type ReadPlan,
  type ScheduleOptions,
  type WatchEntry,
} from "./board.ts";
export { gtinCheckDigit, parseGtin } from "./gtin.ts";
export { foldCode, matchKeys, type Identifiers, type PartNumber } from "./identifiers.ts";
export {
  bestOffer,
  latestObservations,
  offersOfPart,
  offersPart,
  type BestOffer,
  type BestOfferOptions,
  type Observation,
  type OfferChoice,
  type PartWant,
} from "./offers.ts";
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
  type Rating,
  type Seller,
  type Shipping,
  type Spec,
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
