/**
 * The fixtures of the tests: one answer of each API in its documented shape, from the developer documentation of
 * each seller. All values are fake, and each link goes to `example.com`. The GTIN-12 `036000291452` has a valid
 * check digit.
 */
import fc from "fast-check";
import type { Observation, ParseResult } from "../src/parse.ts";

/** This function gives the observations of a result, and it throws when the parser refused the answer. */
export function observations(result: ParseResult): readonly Observation[] {
  if (!result.ok) throw new Error(`The parser refused the answer: ${result.problems.join(" ")}`);
  return result.observations;
}

/** This function gives the notes of a result, and it throws when the parser refused the answer. */
export function notes(result: ParseResult): readonly string[] {
  if (!result.ok) throw new Error(`The parser refused the answer: ${result.problems.join(" ")}`);
  return result.notes;
}

/** The instant of each answer of the tests. */
export const AT = "2026-11-12T18:00:00Z";

/** This function gives an amount in US dollars. */
export const usd = (value: number): { value: number; unit: string } => ({ value, unit: "USD" });

/** The answer of `getItem` of the eBay Browse API (`Item` of the OpenAPI contract of eBay). */
export const ebayItem = {
  itemId: "v1|110000000001|0",
  legacyItemId: "110000000001",
  title: "ExampleBrand Example Widget 1000, 16 GB, Black",
  price: { value: "129.99", currency: "USD" },
  marketingPrice: {
    originalPrice: { value: "159.99", currency: "USD" },
    discountAmount: { value: "30.00", currency: "USD" },
    discountPercentage: "19",
  },
  condition: "Used",
  conditionId: "3000",
  itemWebUrl: "https://www.example.com/itm/110000000001",
  seller: { username: "example_seller", feedbackPercentage: "99.2", feedbackScore: 1234 },
  shippingOptions: [
    { shippingServiceCode: "ExampleGround", shippingCostType: "FIXED", shippingCost: { value: "4.99", currency: "USD" } },
  ],
  buyingOptions: ["FIXED_PRICE", "BEST_OFFER"],
  itemEndDate: "2026-12-31T23:59:59.000Z",
  gtin: "036000291452",
  mpn: "EXW-1000",
  brand: "ExampleBrand",
  epid: "1000000001",
  localizedAspects: [
    { type: "STRING", name: "Brand", value: "ExampleBrand" },
    { type: "STRING", name: "MPN", value: "EXW-1000" },
    { type: "STRING", name: "Storage Capacity", value: "16 GB" },
  ],
  estimatedAvailabilities: [{ estimatedAvailabilityStatus: "IN_STOCK", estimatedAvailableQuantity: 3, estimatedSoldQuantity: 7 }],
};

/** One `ItemSummary` of a search of the eBay Browse API. It has no GTIN, part number, aspects or stock. */
export const ebaySummary = {
  itemId: "v1|110000000001|0",
  title: "ExampleBrand Example Widget 1000, 16 GB, Black",
  price: { value: "129.99", currency: "USD" },
  condition: "Used",
  conditionId: "3000",
  itemWebUrl: "https://www.example.com/itm/110000000001",
  seller: { username: "example_seller", feedbackPercentage: "99.2", feedbackScore: 1234 },
  shippingOptions: [{ shippingCostType: "FIXED", shippingCost: { value: "0.00", currency: "USD" } }],
  buyingOptions: ["FIXED_PRICE"],
  itemEndDate: "2026-12-31T23:59:59.000Z",
};

/** The answer of `search` of the eBay Browse API (`SearchPagedCollection`). */
export const ebaySearch = {
  href: "https://www.example.com/buy/browse/v1/item_summary/search?q=widget",
  total: 1,
  limit: 50,
  offset: 0,
  itemSummaries: [ebaySummary],
};

/** The answer of one product of the Best Buy Products API (`GET /v1/products/{sku}.json`). */
export const bestBuyProduct = {
  sku: 1234567,
  name: "ExampleBrand - Example Widget 1000 - Black",
  upc: "036000291452",
  modelNumber: "EXW-1000",
  manufacturer: "ExampleBrand",
  salePrice: 99.99,
  regularPrice: 129.99,
  onSale: true,
  dollarSavings: 30,
  percentSavings: "23.1",
  freeShipping: false,
  shippingCost: "",
  shipping: [{ ground: "", secondDay: "", nextDay: "", vendorDelivery: "" }],
  shippingLevelsOfService: [],
  onlineAvailability: true,
  inStoreAvailability: true,
  orderable: "Available",
  condition: "New",
  preowned: false,
  quantityLimit: 3,
  active: true,
  url: "https://www.example.com/click/-/1234567/pdp",
  categoryPath: [
    { id: "cat00000", name: "Best Buy" },
    { id: "exmp0000001", name: "Example Category" },
  ],
  customerReviewAverage: 4.6,
  customerReviewCount: 120,
  priceUpdateDate: "2026-11-01T10:11:51",
  itemUpdateDate: "2026-11-02T10:26:16",
  startDate: "2026-02-06",
};

/** The answer of a search of the Best Buy Products API in the page form. */
export const bestBuyProducts = {
  from: 1,
  to: 1,
  total: 1,
  currentPage: 1,
  totalPages: 1,
  queryTime: "0.005",
  totalTime: "0.020",
  partial: false,
  canonicalUrl: "/v1/products(sku=1234567)?format=json&apiKey=XXX",
  products: [bestBuyProduct],
};

/** The answer of the Best Buy Open Box API (`GET /beta/products/{sku}/openBox`). */
export const bestBuyOpenBox = {
  metadata: {
    context: { canonicalUrl: "https://www.example.com/beta/products/1234567/openBox?format=json&apiKey=XXX" },
    resultSet: { count: 1 },
  },
  results: [
    {
      customerReviews: { averageScore: 4.6, count: 120 },
      descriptions: { short: "Example short description." },
      images: { standard: "https://www.example.com/images/1234567.jpg" },
      links: {
        product: "https://www.example.com/v1/products/1234567.json?apiKey=XXX",
        web: "https://www.example.com/click/-/1234567/pdp#tab=buyingOptions",
        addToCart: "https://www.example.com/click/-/1234567/cart?listing_id=2",
      },
      names: { title: "ExampleBrand - Example Widget 1000 - Black" },
      offers: [
        {
          condition: "excellent",
          prices: { current: 84.99, regular: 129.99 },
          onlineAvailability: true,
          inStoreAvailability: true,
          listingId: "2",
          sellerId: null,
        },
        {
          condition: "certified",
          prices: { current: 89.99, regular: 129.99 },
          onlineAvailability: false,
          inStoreAvailability: true,
          listingId: "3",
          sellerId: null,
        },
      ],
      prices: { current: 99.99, regular: 129.99 },
      sku: "1234567",
    },
  ],
};

/** One `Product` of the Digi-Key Product Information API v4, with each key of the Swagger file. */
export const digiKeyProduct = {
  Description: {
    ProductDescription: "RES 10K OHM 1% 1/10W 0603",
    DetailedDescription: "10 kOhms ±1% 0.1W, 1/10W Chip Resistor 0603 (1608 Metric) Example Film",
  },
  Manufacturer: { Id: 9001, Name: "ExampleBrand" },
  ManufacturerProductNumber: "EXR-0603-10K",
  UnitPrice: 0.1,
  ProductUrl: "https://www.example.com/en/products/detail/examplebrand/EXR-0603-10K/1000001",
  DatasheetUrl: "https://www.example.com/datasheets/EXR-0603.pdf",
  PhotoUrl: "https://www.example.com/photos/EXR-0603.jpg",
  PrimaryVideoUrl: "",
  ProductVariations: [
    {
      DigiKeyProductNumber: "EXR-0603-10KCT-ND",
      PackageType: { Id: 2, Name: "Cut Tape (CT)" },
      StandardPricing: [
        { BreakQuantity: 1, UnitPrice: 0.1, TotalPrice: 0.1 },
        { BreakQuantity: 10, UnitPrice: 0.05, TotalPrice: 0.5 },
        { BreakQuantity: 100, UnitPrice: 0.02, TotalPrice: 2.0 },
      ],
      MyPricing: [],
      MarketPlace: false,
      TariffActive: false,
      Supplier: { Id: 9001, Name: "ExampleBrand" },
      QuantityAvailableforPackageType: 25000,
      MaxQuantityForDistribution: 25000,
      MinimumOrderQuantity: 1,
      StandardPackage: 5000,
      DigiReelFee: 0.0,
    },
    {
      DigiKeyProductNumber: "EXR-0603-10KTR-ND",
      PackageType: { Id: 1, Name: "Tape & Reel (TR)" },
      StandardPricing: [
        { BreakQuantity: 5000, UnitPrice: 0.004, TotalPrice: 20.0 },
        { BreakQuantity: 10000, UnitPrice: 0.003, TotalPrice: 30.0 },
      ],
      MyPricing: [],
      MarketPlace: false,
      TariffActive: false,
      Supplier: { Id: 9001, Name: "ExampleBrand" },
      QuantityAvailableforPackageType: 0,
      MaxQuantityForDistribution: 0,
      MinimumOrderQuantity: 5000,
      StandardPackage: 5000,
      DigiReelFee: 0.0,
    },
  ],
  QuantityAvailable: 25000,
  ProductStatus: { Id: 0, Status: "Active" },
  BackOrderNotAllowed: false,
  NormallyStocking: true,
  Discontinued: false,
  EndOfLife: false,
  Ncnr: false,
  Parameters: [
    { ParameterId: 2085, ParameterText: "Resistance", ParameterType: "String", ValueId: "10000", ValueText: "10 kOhms" },
    { ParameterId: 3, ParameterText: "Tolerance", ParameterType: "String", ValueId: "1", ValueText: "±1%" },
  ],
  BaseProductNumber: { Id: 9100, Name: "EXR-0603" },
  Category: {
    CategoryId: 52,
    ParentId: 2,
    Name: "Chip Resistor - Surface Mount",
    ProductCount: 1000,
    NewProductCount: 10,
    ImageUrl: "https://www.example.com/categories/52.jpg",
    SeoDescription: "Example category description.",
    ChildCategories: [],
  },
  DateLastBuyChance: "2027-06-30T00:00:00Z",
  ManufacturerLeadWeeks: "8",
  ManufacturerPublicQuantity: 0,
  Series: { Id: 9200, Name: "EXR" },
  ShippingInfo: "",
  Classifications: {
    ReachStatus: "REACH Unaffected",
    RohsStatus: "ROHS3 Compliant",
    MoistureSensitivityLevel: "1  (Unlimited)",
    ExportControlClassNumber: "EAR99",
    HtsusCode: "8533.21.0030",
  },
  OtherNames: ["EXR0603-10K"],
};

/** The locale of each Digi-Key answer of the tests. */
export const digiKeyLocale = { Site: "US", Language: "en", Currency: "USD" };

/** The answer of `ProductDetails` of the Digi-Key Product Information API v4. */
export const digiKeyDetails = { SearchLocaleUsed: digiKeyLocale, Product: digiKeyProduct, AccountIdUsed: 0, CustomerIdUsed: 0 };

/** The answer of `KeywordSearch` of the Digi-Key Product Information API v4. */
export const digiKeyKeyword = {
  Products: [digiKeyProduct],
  ProductsCount: 1,
  ExactMatches: [digiKeyProduct],
  SearchLocaleUsed: digiKeyLocale,
};

type Step = string | number;

function paths(value: unknown, prefix: readonly Step[] = []): Step[][] {
  const here: Step[][] = prefix.length === 0 ? [] : [[...prefix]];
  if (Array.isArray(value)) return [...here, ...value.flatMap((each, index) => paths(each, [...prefix, index]))];
  if (typeof value === "object" && value !== null) {
    return [...here, ...Object.entries(value).flatMap(([key, each]) => paths(each, [...prefix, key]))];
  }
  return here;
}

function replaced(value: unknown, at: readonly Step[], next: unknown): unknown {
  const [step, ...rest] = at;
  if (step === undefined) return next;
  if (Array.isArray(value) && typeof step === "number") {
    const copy = [...value];
    if (rest.length === 0 && next === DELETE) copy.splice(step, 1);
    else copy[step] = replaced(copy[step], rest, next);
    return copy;
  }
  if (typeof value === "object" && value !== null && typeof step === "string") {
    const copy: Record<string, unknown> = { ...value };
    if (rest.length === 0 && next === DELETE) delete copy[step];
    else copy[step] = replaced(copy[step], rest, next);
    return copy;
  }
  return value;
}

const DELETE = Symbol("delete");

/** The values that a mutation puts in place of a field: the edge values of JSON, and each other JSON value. */
const replacement: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom<unknown>(DELETE, null, "", " ", 0, -1, 1.5, "0", "-1", "1e3", "abc", true, false, [], {}),
  fc.jsonValue({ maxDepth: 2 }),
);

/**
 * This arbitrary gives a mutated copy of a JSON answer. It changes up to 6 fields at random paths. It deletes each
 * field, or it puts an edge value or a random JSON value in its place.
 */
export function mutated(answer: unknown): fc.Arbitrary<unknown> {
  const all = paths(answer);
  return fc
    .array(fc.tuple(fc.nat({ max: all.length - 1 }), replacement), { maxLength: 6 })
    .map((changes) => changes.reduce((value, [index, next]) => replaced(value, all[index] ?? [], next), answer));
}
