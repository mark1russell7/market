import { describe, expect, it } from "vitest";
import * as entry from "./index.ts";

describe("the entry", () => {
  it("exports the records, their checks and the functions", () => {
    expect(Object.keys(entry).sort()).toEqual([
      "AVAILABILITIES",
      "CONDITIONS",
      "FORMATS",
      "costOf",
      "foldCode",
      "gtinCheckDigit",
      "gtinSchema",
      "instantSchema",
      "isKept",
      "keepUntil",
      "matchKeys",
      "moneySchema",
      "offerId",
      "offerSchema",
      "parseGtin",
      "partNumberSchema",
      "permitsHistory",
      "permitsTrend",
      "priceBreakSchema",
      "priceReadingSchema",
      "productSchema",
      "retentionSchema",
      "sellerSchema",
      "shippingSchema",
      "sourceOfOffer",
      "sourceSchema",
      "sourceTermsSchema",
      "specSchema",
      "textSchema",
      "unitPriceFor",
    ]);
  });
});
