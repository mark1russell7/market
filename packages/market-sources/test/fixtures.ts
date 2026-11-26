/**
 * The fixtures of the tests: one answer of each API in its documented shape, from the developer documentation of
 * each seller. All values are fake, and each link goes to `example.com`. The GTIN-12 `036000291452` has a valid
 * check digit. The page of the Azure Retail Prices API is the exception: it has real public rows.
 */
import fc from "fast-check";
import type { MeteredObservation, MeteredParseResult, Observation, ParseResult } from "../src/parse.ts";

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

/** This function gives the metered observations of a result, and it throws when the parser refused the answer. */
export function meteredObservations(result: MeteredParseResult): readonly MeteredObservation[] {
  if (!result.ok) throw new Error(`The parser refused the answer: ${result.problems.join(" ")}`);
  return result.observations;
}

/** This function gives the notes of a metered result, and it throws when the parser refused the answer. */
export function meteredNotes(result: MeteredParseResult): readonly string[] {
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

/**
 * A page of the Azure Retail Prices API with 18 real public rows. The rows came from
 * `https://prices.azure.com/api/retail/prices` with `api-version=2023-01-01-preview` on 2026-11-18. Each row keeps
 * only the fields that the parser reads. The rows are these:
 *
 * - The meters of data out of Bandwidth in `westeurope`. The egress meter has 6 tiers, and its first 100 GB are free.
 * - The meters of the Hot LRS tier of Blob Storage in `westeurope`. Its data meter has 3 tiers.
 * - The E64 v4 VM in `southcentralus`: on demand with two savings plans, two reservations, and spot with Dev/Test.
 */
export const azurePage = {
  BillingCurrency: "USD",
  Items: [
    {currencyCode: "USD", tierMinimumUnits: 0, retailPrice: 0, armRegionName: "westeurope", location: "EU West", meterId: "9995d93a-7d35-4d3f-9c69-7a7fea447ef4", meterName: "Standard Data Transfer Out", productName: "Rtn Preference: MGN", skuId: "DZH318Z0BNVX/003F", skuName: "Standard", serviceName: "Bandwidth", serviceFamily: "Networking", unitOfMeasure: "1 GB", type: "Consumption", armSkuName: ""},
    {currencyCode: "USD", tierMinimumUnits: 100, retailPrice: 0.087, armRegionName: "westeurope", location: "EU West", meterId: "9995d93a-7d35-4d3f-9c69-7a7fea447ef4", meterName: "Standard Data Transfer Out", productName: "Rtn Preference: MGN", skuId: "DZH318Z0BNVX/003F", skuName: "Standard", serviceName: "Bandwidth", serviceFamily: "Networking", unitOfMeasure: "1 GB", type: "Consumption", armSkuName: ""},
    {currencyCode: "USD", tierMinimumUnits: 10335, retailPrice: 0.083, armRegionName: "westeurope", location: "EU West", meterId: "9995d93a-7d35-4d3f-9c69-7a7fea447ef4", meterName: "Standard Data Transfer Out", productName: "Rtn Preference: MGN", skuId: "DZH318Z0BNVX/003F", skuName: "Standard", serviceName: "Bandwidth", serviceFamily: "Networking", unitOfMeasure: "1 GB", type: "Consumption", armSkuName: ""},
    {currencyCode: "USD", tierMinimumUnits: 51295, retailPrice: 0.07, armRegionName: "westeurope", location: "EU West", meterId: "9995d93a-7d35-4d3f-9c69-7a7fea447ef4", meterName: "Standard Data Transfer Out", productName: "Rtn Preference: MGN", skuId: "DZH318Z0BNVX/003F", skuName: "Standard", serviceName: "Bandwidth", serviceFamily: "Networking", unitOfMeasure: "1 GB", type: "Consumption", armSkuName: ""},
    {currencyCode: "USD", tierMinimumUnits: 153695, retailPrice: 0.05, armRegionName: "westeurope", location: "EU West", meterId: "9995d93a-7d35-4d3f-9c69-7a7fea447ef4", meterName: "Standard Data Transfer Out", productName: "Rtn Preference: MGN", skuId: "DZH318Z0BNVX/003F", skuName: "Standard", serviceName: "Bandwidth", serviceFamily: "Networking", unitOfMeasure: "1 GB", type: "Consumption", armSkuName: ""},
    {currencyCode: "USD", tierMinimumUnits: 512095, retailPrice: 0.05, armRegionName: "westeurope", location: "EU West", meterId: "9995d93a-7d35-4d3f-9c69-7a7fea447ef4", meterName: "Standard Data Transfer Out", productName: "Rtn Preference: MGN", skuId: "DZH318Z0BNVX/003F", skuName: "Standard", serviceName: "Bandwidth", serviceFamily: "Networking", unitOfMeasure: "1 GB", type: "Consumption", armSkuName: ""},
    {currencyCode: "USD", tierMinimumUnits: 0, retailPrice: 0.02, armRegionName: "westeurope", location: "EU West", meterId: "fbf3fda7-3c77-5760-888c-abd984ffd63e", meterName: "Standard Inter-Region Data Transfer", productName: "Rtn Preference: MGN", skuId: "DZH318Z0BNVX/003F", skuName: "Standard", serviceName: "Bandwidth", serviceFamily: "Networking", unitOfMeasure: "1 GB", type: "Consumption", armSkuName: ""},
    {currencyCode: "USD", tierMinimumUnits: 0, retailPrice: 0.0196, armRegionName: "westeurope", location: "EU West", meterId: "10e5ee74-8fd6-4972-909f-65a83f92f0ce", meterName: "Hot LRS Data Stored", productName: "Blob Storage", skuId: "DZH318Z0BNZJ/008R", skuName: "Hot LRS", serviceName: "Storage", serviceFamily: "Storage", unitOfMeasure: "1 GB/Month", type: "Consumption", armSkuName: ""},
    {currencyCode: "USD", tierMinimumUnits: 51200, retailPrice: 0.018816, armRegionName: "westeurope", location: "EU West", meterId: "10e5ee74-8fd6-4972-909f-65a83f92f0ce", meterName: "Hot LRS Data Stored", productName: "Blob Storage", skuId: "DZH318Z0BNZJ/008R", skuName: "Hot LRS", serviceName: "Storage", serviceFamily: "Storage", unitOfMeasure: "1 GB/Month", type: "Consumption", armSkuName: ""},
    {currencyCode: "USD", tierMinimumUnits: 512000, retailPrice: 0.018032, armRegionName: "westeurope", location: "EU West", meterId: "10e5ee74-8fd6-4972-909f-65a83f92f0ce", meterName: "Hot LRS Data Stored", productName: "Blob Storage", skuId: "DZH318Z0BNZJ/008R", skuName: "Hot LRS", serviceName: "Storage", serviceFamily: "Storage", unitOfMeasure: "1 GB/Month", type: "Consumption", armSkuName: ""},
    {currencyCode: "USD", tierMinimumUnits: 0, retailPrice: 0.054, armRegionName: "westeurope", location: "EU West", meterId: "15adff7b-0dab-4c00-889d-caa6d4fb31bb", meterName: "Hot LRS Write Operations", productName: "Blob Storage", skuId: "DZH318Z0BNZJ/008R", skuName: "Hot LRS", serviceName: "Storage", serviceFamily: "Storage", unitOfMeasure: "10K", type: "Consumption", armSkuName: ""},
    {currencyCode: "USD", tierMinimumUnits: 0, retailPrice: 0.0043, armRegionName: "westeurope", location: "EU West", meterId: "36c961e5-3c53-4481-b339-a10c6fe0f491", meterName: "Hot Read Operations", productName: "Blob Storage", skuId: "DZH318Z0BNZJ/008R", skuName: "Hot LRS", serviceName: "Storage", serviceFamily: "Storage", unitOfMeasure: "10K", type: "Consumption", armSkuName: ""},
    {currencyCode: "USD", tierMinimumUnits: 0, retailPrice: 0.039, armRegionName: "westeurope", location: "EU West", meterId: "2fb5f78a-0428-4e17-8fee-5b176a3ef34c", meterName: "Index Tags", productName: "Blob Storage", skuId: "DZH318Z0BNZJ/008R", skuName: "Hot LRS", serviceName: "Storage", serviceFamily: "Storage", unitOfMeasure: "10K/Month", type: "Consumption", armSkuName: ""},
    {currencyCode: "USD", tierMinimumUnits: 0, retailPrice: 4.838, armRegionName: "southcentralus", location: "US South Central", meterId: "0016083a-928f-56fd-8eeb-39287dcf676d", meterName: "E64 v4", productName: "Virtual Machines Ev4 Series", skuId: "DZH318Z0D1L7/0058", skuName: "E64 v4", serviceName: "Virtual Machines", serviceFamily: "Compute", unitOfMeasure: "1 Hour", type: "Consumption", armSkuName: "Standard_E64_v4", savingsPlan: [{retailPrice: 2.2917606, term: "3 Years"},{retailPrice: 3.2743584, term: "1 Year"}]},
    {currencyCode: "USD", tierMinimumUnits: 0, reservationTerm: "1 Year", retailPrice: 25007, armRegionName: "southcentralus", location: "US South Central", meterId: "0016083a-928f-56fd-8eeb-39287dcf676d", meterName: "E64 v4", productName: "Virtual Machines Ev4 Series", skuId: "DZH318Z0D1L7/018J", skuName: "E64 v4", serviceName: "Virtual Machines", serviceFamily: "Compute", unitOfMeasure: "1 Hour", type: "Reservation", armSkuName: "Standard_E64_v4"},
    {currencyCode: "USD", tierMinimumUnits: 0, reservationTerm: "3 Years", retailPrice: 48318, armRegionName: "southcentralus", location: "US South Central", meterId: "0016083a-928f-56fd-8eeb-39287dcf676d", meterName: "E64 v4", productName: "Virtual Machines Ev4 Series", skuId: "DZH318Z0D1L7/018F", skuName: "E64 v4", serviceName: "Virtual Machines", serviceFamily: "Compute", unitOfMeasure: "1 Hour", type: "Reservation", armSkuName: "Standard_E64_v4"},
    {currencyCode: "USD", tierMinimumUnits: 0, retailPrice: 1.438114, armRegionName: "southcentralus", location: "US South Central", meterId: "78567729-27e1-5104-bdbc-2f9cc07d24ef", meterName: "E64 v4 Spot", productName: "Virtual Machines Ev4 Series Windows", skuId: "DZH318Z0D1L3/006C", skuName: "E64 v4 Spot", serviceName: "Virtual Machines", serviceFamily: "Compute", unitOfMeasure: "1 Hour", type: "Consumption", armSkuName: "Standard_E64_v4"},
    {currencyCode: "USD", tierMinimumUnits: 0, retailPrice: 0.894062, armRegionName: "southcentralus", location: "US South Central", meterId: "78567729-27e1-5104-bdbc-2f9cc07d24ef", meterName: "E64 v4 Spot", productName: "Virtual Machines Ev4 Series Windows", skuId: "DZH318Z0D1L3/006C", skuName: "E64 v4 Spot", serviceName: "Virtual Machines", serviceFamily: "Compute", unitOfMeasure: "1 Hour", type: "DevTestConsumption", armSkuName: "Standard_E64_v4"},
  ],
  NextPageLink: null,
  Count: 18,
};

/** The location id of the Kroger fixtures. It is a fake id. */
export const KROGER_LOCATION = "01234567";

/**
 * A product of the Kroger Products API at a location (`products.productModel` of the OpenAPI contract 1.3.0). The
 * product id is the GTIN-12 `036000291452` with no check digit, in 13 digits.
 */
export const krogerProduct = {
  productId: "0003600029145",
  productPageURI: "/p/examplebrand-spring-water/0003600029145?cid=example",
  aliasProductIds: [],
  aisleLocations: [{ number: "7", description: "Aisle 7" }],
  brand: "ExampleBrand",
  categories: ["Beverages"],
  countryOrigin: "United States",
  description: "ExampleBrand Spring Water 24 Bottles",
  snapEligible: true,
  upc: "0003600029145",
  items: [
    {
      itemId: "0003600029145",
      inventory: { stockLevel: "HIGH" },
      favorite: false,
      fulfillment: { curbside: true, delivery: true, instore: true, shiptohome: false },
      price: {
        regular: 4.99,
        promo: 3.99,
        regularPerUnitEstimate: 4.99,
        promoPerUnitEstimate: 3.99,
        expirationDate: { value: "2026-11-30T00:00:00Z", timezone: "UTC" },
        effectiveDate: { value: "2026-11-01T00:00:00Z", timezone: "UTC" },
      },
      nationalPrice: { regular: 5.29, promo: 0 },
      size: "24 ct / 16.9 fl oz",
      soldBy: "UNIT",
    },
  ],
};

/** The answer of Product details of the Kroger Products API (`products.productPayloadModel`). */
export const krogerDetails = { data: krogerProduct, meta: {} };

/** The answer of Product search of the Kroger Products API (`products.productsPayloadModel`), with two products. */
export const krogerSearch = {
  data: [
    krogerProduct,
    {
      ...krogerProduct,
      productId: "0001111041700",
      productPageURI: "/p/examplebrand-2-reduced-fat-milk/0001111041700",
      description: "ExampleBrand 2% Reduced Fat Milk",
      upc: "0001111041700",
      items: [
        {
          itemId: "0001111041700",
          inventory: { stockLevel: "LOW" },
          fulfillment: { curbside: false, delivery: false, instore: true, shiptohome: false },
          price: { regular: 1.99, promo: 0 },
          size: "1 gal",
          soldBy: "UNIT",
        },
      ],
    },
  ],
  meta: { pagination: { start: 0, limit: 10, total: 2 } },
};

/**
 * A location of the Kroger Locations API in the documented shape (`locations.location`), with made-up values. The
 * answer has more fields (`hours`, `departments`) that the parser does not read.
 */
export const krogerLocationRecord = {
  address: {
    addressLine1: "100 Example Avenue",
    addressLine2: "",
    city: "Exampleton",
    county: "EXAMPLE COUNTY",
    state: "OH",
    zipCode: "45000",
  },
  chain: "KROGER",
  phone: "5550100000",
  departments: [{ departmentId: "01", name: "Example Department" }],
  geolocation: { latLng: "39.1,-84.5", latitude: 39.1, longitude: -84.5 },
  hours: { Open24: false, gmtOffset: "(UTC-05:00) Eastern Time" },
  locationId: KROGER_LOCATION,
  storeNumber: "34567",
  divisionNumber: "012",
  name: "Kroger Example Riverside",
};

/** The answer of Location details of the Kroger Locations API. */
export const krogerLocationDetails = { data: krogerLocationRecord, meta: {} };

/** The answer of Location search of the Kroger Locations API, with two locations. */
export const krogerLocationSearch = {
  data: [
    krogerLocationRecord,
    {
      ...krogerLocationRecord,
      address: { ...krogerLocationRecord.address, addressLine1: "200 Example Road", addressLine2: "Suite 2" },
      chain: "EXAMPLEMART",
      geolocation: { latLng: "39.2,-84.6", latitude: 39.2, longitude: -84.6 },
      locationId: "07654321",
      storeNumber: "54321",
      divisionNumber: "076",
      name: "ExampleMart North",
    },
  ],
  meta: { pagination: { start: 0, limit: 10, total: 2 }, warnings: [] },
};
