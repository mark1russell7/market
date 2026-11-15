import type { Observation, Offer, PartWant, PriceReading, SourceTerms } from "@mark1russell7/market";

/**
 * The sample data of the demo. The makers, the sources and the prices are not real: they show how the package
 * chooses an offer. A live source gives the same records.
 */

/** The instant of the latest readings of the sample. */
export const SAMPLE_AT = "2026-11-15T12:00:00Z";

/** The part that the buyer of the sample wants. A seller can write the brand of the maker in two forms. */
export const SAMPLE_WANT: PartWant = { brands: ["Acme", "Acme Storage"], partNumbers: ["ACM-NV1T"] };

/** The name of the part of the sample. */
export const SAMPLE_PART = "Acme 1 TB NVMe drive";

const usd = (value: number) => ({ value, unit: "USD" });

interface Make {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly brand: string;
  readonly part: string;
  readonly seller: string;
  readonly condition?: Offer["condition"];
  readonly format?: Offer["format"];
  readonly reading: Omit<PriceReading, "offerId" | "at"> & { readonly at?: string };
}

const labels = new Map<string, string>();

function observation(make: Make): Observation {
  labels.set(make.id, make.label);
  const colon = make.id.indexOf(":");
  const offer: Offer = {
    id: make.id,
    source: make.id.slice(0, colon),
    sourceId: make.id.slice(colon + 1),
    title: make.title,
    seller: { name: make.seller },
    condition: make.condition ?? "new",
    format: make.format ?? "fixed-price",
    gtins: [],
    partNumbers: [{ brand: make.brand, partNumber: make.part }],
    specs: [],
  };
  const { at = SAMPLE_AT, ...rest } = make.reading;
  return { offer, reading: { offerId: make.id, at, ...rest } };
}

/**
 * The offers of the sample, each with its latest reading. The order of this list gives the color of each offer,
 * so a color follows its offer and not its rank.
 */
export const SAMPLE_OFFERS: readonly Observation[] = [
  observation({
    id: "shop-a:1001",
    label: "Shop A",
    title: "Acme 1TB NVMe SSD",
    brand: "Acme",
    part: "ACM-NV1T0B",
    seller: "Shop A",
    reading: { price: usd(89.99), shipping: { kind: "free" }, availability: "in-stock" },
  }),
  observation({
    id: "shop-a:1002",
    label: "Shop A, bulk",
    title: "Acme NVMe drive 1 TB, bulk box",
    brand: "Acme",
    part: "ACM-NV1T0B-BX",
    seller: "Shop A",
    reading: { price: usd(87.49), shipping: { kind: "free" }, availability: "out-of-stock" },
  }),
  observation({
    id: "parts-b:NV1T-ND",
    label: "Parts B",
    title: "SSD 1TB M.2 NVMe, cut tape",
    brand: "Acme Storage",
    part: "ACM-NV1T0B/AM",
    seller: "Parts B",
    reading: {
      price: usd(92.4),
      shipping: { kind: "fixed", cost: usd(6.99) },
      availability: "in-stock",
      available: 412,
      priceBreaks: [
        { quantity: 10, unitPrice: usd(86.1) },
        { quantity: 50, unitPrice: usd(79.85) },
      ],
    },
  }),
  observation({
    id: "parts-b:NV1T-TR",
    label: "Parts B, tray",
    title: "SSD 1TB M.2 NVMe, tray of 25",
    brand: "Acme Storage",
    part: "ACM-NV1T0B/TR",
    seller: "Parts B",
    reading: {
      price: usd(74.5),
      shipping: { kind: "fixed", cost: usd(12) },
      availability: "in-stock",
      minimumQuantity: 25,
      priceBreaks: [{ quantity: 100, unitPrice: usd(71) }],
    },
  }),
  observation({
    id: "bids-c:5531",
    label: "Bids C, used",
    title: "Acme 1TB NVMe, used, 300 hours",
    brand: "Acme",
    part: "ACM-NV1T0B",
    seller: "Bids C",
    condition: "used",
    format: "auction",
    reading: { price: usd(52), shipping: { kind: "calculated" }, availability: "in-stock" },
  }),
  observation({
    id: "bids-c:5532",
    label: "Bids C, refurbished",
    title: "Acme 1 TB NVMe SSD, refurbished by the maker",
    brand: "Acme",
    part: "ACM-NV1T0B",
    seller: "Bids C",
    condition: "refurbished",
    reading: { price: usd(64.99), shipping: { kind: "fixed", cost: usd(4.5) }, availability: "low-stock" },
  }),
  observation({
    id: "shop-a:1003",
    label: "Shop A, 512 GB",
    title: "Acme 512GB NVMe SSD",
    brand: "Acme",
    part: "ACM-NV512B",
    seller: "Shop A",
    reading: { price: usd(54.99), shipping: { kind: "free" }, availability: "in-stock" },
  }),
  observation({
    id: "euro-d:NV1T",
    label: "Euro D",
    title: "Acme SSD 1 TB NVMe",
    brand: "ACME",
    part: "acm nv1t0b",
    seller: "Euro D",
    reading: { price: { value: 84.9, unit: "EUR" }, shipping: { kind: "free" }, availability: "in-stock" },
  }),
  observation({
    id: "bids-c:5600",
    label: "Bids C, tip",
    title: "Replacement tip ACM-NV1T for a solder station",
    brand: "Bolt Tools",
    part: "ACM-NV1T",
    seller: "Bids C",
    reading: { price: usd(8.5), shipping: { kind: "free" }, availability: "in-stock" },
  }),
];

/**
 * The older readings of the sample. `bestOffer` reads only the latest reading of each offer, so these readings do
 * not change the choice.
 */
export const SAMPLE_OLDER: readonly Observation[] = [
  { offer: (SAMPLE_OFFERS[0] as Observation).offer, reading: { ...(SAMPLE_OFFERS[0] as Observation).reading, at: "2026-11-14T12:00:00Z", price: usd(94.99) } },
  { offer: (SAMPLE_OFFERS[2] as Observation).offer, reading: { ...(SAMPLE_OFFERS[2] as Observation).reading, at: "2026-11-13T12:00:00Z", price: usd(95.1) } },
];

/** The terms of the sources of the sample. Each source has its own storage rule. */
export const SAMPLE_TERMS: readonly SourceTerms[] = [
  { source: "shop-a", retention: { kind: "keep" }, deleteWhenEnded: false, priceModel: true, clause: "Sample terms of Shop A" },
  {
    source: "parts-b",
    retention: { kind: "max-age", age: { value: 24, unit: "h" } },
    deleteWhenEnded: false,
    priceModel: false,
    clause: "Sample terms of Parts B",
  },
  {
    source: "bids-c",
    retention: { kind: "max-age", age: { value: 6, unit: "h" } },
    deleteWhenEnded: true,
    priceModel: false,
    clause: "Sample terms of Bids C",
  },
  { source: "euro-d", retention: { kind: "no-store" }, deleteWhenEnded: true, priceModel: false, clause: "Sample terms of Euro D" },
];

/** The sample codes of the GTIN check, each with its name. */
export const SAMPLE_CODES: readonly { readonly name: string; readonly code: string }[] = [
  { name: "A UPC-A", code: "0 12345 67890 5" },
  { name: "An EAN-13", code: "4006381333931" },
  { name: "A typing error", code: "0 12345 67980 5" },
  { name: "Too short", code: "12345" },
];

/** This function gives the short label of a sample offer for the chart, the legend and the table. */
export function labelOf(offerId: string): string {
  return labels.get(offerId) ?? offerId;
}
