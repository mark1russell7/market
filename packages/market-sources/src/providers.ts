/**
 * The records of the providers with a plan list. Each record is data for `parsePlanLists` and the plan client. A
 * host can also load a record from a JSON file with `parsePlanProvider`.
 *
 * The terms of these sources are the strictest rules: no stored reading and no price model. The terms pages of
 * these providers refused an automated read on 2026-11-18. A person reads the terms before a rule changes.
 */
import type { SourceTerms } from "@mark1russell7/market";
import type { PlanListRead, PlanProvider } from "./plans.ts";

/** The name of the Vultr source. */
export const VULTR_SOURCE = "vultr";

/** The terms of the Vultr source. A reading serves one request. */
export const VULTR_TERMS: SourceTerms = {
  source: VULTR_SOURCE,
  retention: { kind: "no-store" },
  deleteWhenEnded: false,
  priceModel: false,
  clause:
    "Not read: the terms pages of vultr.com refused an automated read on 2026-11-18. The strictest rule holds until a person reads the terms.",
};

/**
 * The record of the Vultr plan list (`GET /v2/plans` of the API v2). The API gave the list with no key on
 * 2026-11-18. Each plan lists its regions, and the object `location_cost` has the prices that change with the region.
 * A plan has the on-demand term when `deploy_ondemand` is true, and the preemptible term when `deploy_preemptible` is true.
 * The list `GET /v2/regions` tells the country of each region.
 *
 * Vultr gives 30 requests each second for each IP address and no daily limit
 * (https://docs.vultr.com/support/platform/api/what-rate-limits-apply-to-the-vultr-api, updated 2026-10-26, read on
 * 2026-11-26). The pace of 2 s is under that limit, thus the record has no quota.
 */
export const VULTR_PLANS: PlanProvider = {
  source: VULTR_SOURCE,
  provider: "vultr",
  name: "Vultr",
  host: "api.vultr.com",
  paceMs: 2000,
  currency: "USD",
  terms: VULTR_TERMS,
  plans: { path: "/v2/plans", query: { per_page: "500" }, items: "plans", paging: { kind: "cursor", param: "cursor", next: "meta.links.next" } },
  id: "id",
  regions: { kind: "field", path: "locations" },
  regionPrices: { kind: "map", path: "location_cost" },
  places: {
    read: { path: "/v2/regions", query: { per_page: "500" }, items: "regions", paging: { kind: "cursor", param: "cursor", next: "meta.links.next" } },
    id: "id",
    country: "country",
  },
  prices: [
    { key: "on-demand", term: { kind: "on-demand" }, when: "deploy_ondemand", hourly: "hourly_cost", monthly: "monthly_cost" },
    {
      key: "spot",
      term: { kind: "spot" },
      when: "deploy_preemptible",
      hourly: "hourly_cost_preemptible",
      monthly: "monthly_cost_preemptible",
    },
  ],
  specs: [
    { name: "type", path: "type" },
    { name: "vcpu", path: "vcpu_count" },
    { name: "memory", path: "ram", unit: "MiB" },
    { name: "disk", path: "disk", unit: "GB" },
    { name: "disk-type", path: "disk_type" },
    { name: "transfer", path: "bandwidth", unit: "GB" },
    { name: "cpu-vendor", path: "cpu_vendor" },
    { name: "gpu", path: "gpu_type" },
    { name: "gpu-count", path: "gpu_count" },
    { name: "gpu-memory", path: "gpu_vram_gb", unit: "GB" },
  ],
};

/** The name of the Linode source of Akamai Cloud. */
export const LINODE_SOURCE = "linode";

/** The terms of the Linode source. A reading serves one request. */
export const LINODE_TERMS: SourceTerms = {
  source: LINODE_SOURCE,
  retention: { kind: "no-store" },
  deleteWhenEnded: false,
  priceModel: false,
  clause:
    "Not read: the legal pages of akamai.com refused an automated read on 2026-11-18. The API reference tells that these reads need no permissions. The strictest rule holds until a person reads the terms.",
};

const LINODE_PAGES: PlanListRead["paging"] = { kind: "page", param: "page", pages: "pages" };

/**
 * The record of the Linode plan list of Akamai Cloud (`GET /v4/linode/types` of the API v4). The API reference
 * tells that the read needs no permissions. The list of `GET /v4/regions/availability` tells the regions of each
 * plan. The list `region_prices` has the prices that change with the region. The list `GET /v4/regions` tells the
 * country of each region.
 */
export const LINODE_PLANS: PlanProvider = {
  source: LINODE_SOURCE,
  provider: "linode",
  name: "Linode",
  host: "api.linode.com",
  paceMs: 2000,
  currency: "USD",
  terms: LINODE_TERMS,
  plans: { path: "/v4/linode/types", query: { page_size: "500" }, items: "data", paging: LINODE_PAGES },
  id: "id",
  label: "label",
  regions: {
    kind: "list",
    read: { path: "/v4/regions/availability", query: { page_size: "500" }, items: "data", paging: LINODE_PAGES },
    plan: "plan",
    region: "region",
    available: "available",
  },
  regionPrices: { kind: "list", path: "region_prices", id: "id" },
  places: { read: { path: "/v4/regions", query: { page_size: "500" }, items: "data", paging: LINODE_PAGES }, id: "id", country: "country" },
  prices: [
    {
      key: "on-demand",
      term: { kind: "on-demand" },
      hourly: "price.hourly",
      monthly: "price.monthly",
      regionHourly: "hourly",
      regionMonthly: "monthly",
    },
  ],
  specs: [
    { name: "class", path: "class" },
    { name: "vcpu", path: "vcpus" },
    { name: "memory", path: "memory", unit: "MiB" },
    { name: "disk", path: "disk", unit: "MiB" },
    { name: "transfer", path: "transfer", unit: "GB" },
    { name: "gpu-count", path: "gpus" },
    { name: "network-out", path: "network_out", unit: "Mbps" },
  ],
};

/** The record of each provider with a plan list, in the order of the names. */
export const PLAN_PROVIDERS: readonly PlanProvider[] = [LINODE_PLANS, VULTR_PLANS];
