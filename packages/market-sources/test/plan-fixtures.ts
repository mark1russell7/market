/**
 * The fixtures of the plan lists. Each plan is a plan of a public answer of 2026-11-18, with a shorter list of
 * regions. The rows of the regions `id-cgk` and `br-gru` of the Linode availability are made for the tests. The
 * lists of places have the rows of a public answer of 2026-11-25, with only the regions of the plans.
 */

/** A page of the Vultr plan list (`GET /v2/plans`), with three plans and no next page. */
export const vultrPlans = {
  plans: [
    {
      id: "vc2-1c-1gb",
      vcpu_count: 1,
      ram: 1024,
      disk: 25,
      disk_type: "SSD",
      disk_count: 1,
      bandwidth: 1024,
      monthly_cost: 5,
      hourly_cost: 0.007,
      monthly_cost_preemptible: 5,
      hourly_cost_preemptible: 0.007,
      invoice_type: "monthly",
      type: "vc2",
      locations: ["ewr", "ams", "sao"],
      cpu_vendor: "Intel",
      storage_type: "local_storage",
      vcpu_type: "thread",
      deploy_ondemand: true,
      deploy_preemptible: false,
      location_cost: { sao: { monthly_cost: 7.5, hourly_cost: 0.01, monthly_cost_preemptible: 7.5, hourly_cost_preemptible: 0.01 } },
      gpu_brand: "none",
    },
    {
      id: "vcg-h100-216c-1914gb-640vram",
      vcpu_count: 216,
      ram: 1929120,
      disk: 13312,
      disk_type: "DEDICATEDMETAL",
      disk_count: 1,
      bandwidth: 2048,
      monthly_cost: 16074.24,
      hourly_cost: 23.92,
      monthly_cost_preemptible: 12364.8,
      hourly_cost_preemptible: 18.4,
      invoice_type: "hourly",
      type: "vdm",
      locations: [],
      cpu_vendor: "Intel",
      storage_type: "local_storage",
      vcpu_type: "thread",
      deploy_ondemand: false,
      deploy_preemptible: true,
      location_cost: {},
      gpu_brand: "NVIDIA",
    },
    {
      id: "vcg-l40s-16c-180g-48vram",
      vcpu_count: 16,
      ram: 184320,
      disk: 1200,
      disk_type: "CLOUDGPU",
      disk_count: 1,
      bandwidth: 10240,
      monthly_cost: 1122.91,
      hourly_cost: 1.671,
      monthly_cost_preemptible: 1122.91,
      hourly_cost_preemptible: 1.671,
      invoice_type: "hourly",
      type: "vcg",
      locations: [],
      cpu_vendor: "Intel",
      storage_type: "local_storage",
      vcpu_type: "thread",
      deploy_ondemand: true,
      deploy_preemptible: false,
      location_cost: {},
      gpu_brand: "NVIDIA",
      gpu_vram_gb: 48,
      gpu_type: "NVIDIA_L40S",
      gpu_count: 1,
    },
  ],
  meta: { total: 3, links: { next: "", prev: "" } },
};

/** A page of the Linode plan list (`GET /v4/linode/types`), with three plans on one page. */
export const linodeTypes = {
  data: [
    {
      id: "g6-nanode-1",
      label: "Nanode 1GB",
      price: { hourly: 0.0075, monthly: 5 },
      region_prices: [
        { id: "id-cgk", hourly: 0.009, monthly: 6 },
        { id: "br-gru", hourly: 0.0105, monthly: 7 },
      ],
      addons: {
        backups: {
          price: { hourly: 0.003, monthly: 2 },
          region_prices: [
            { id: "id-cgk", hourly: 0.0036, monthly: 2.4 },
            { id: "br-gru", hourly: 0.004, monthly: 2.8 },
          ],
        },
      },
      memory: 1024,
      disk: 25600,
      transfer: 1000,
      vcpus: 1,
      gpus: 0,
      network_out: 1000,
      class: "nanode",
      successor: null,
      capabilities: [],
      accelerated_devices: 0,
    },
    {
      id: "g6-dedicated-2",
      label: "Dedicated 4GB",
      price: { hourly: 0.054, monthly: 36 },
      region_prices: [
        { id: "id-cgk", hourly: 0.065, monthly: 43.2 },
        { id: "br-gru", hourly: 0.076, monthly: 50.4 },
      ],
      addons: {
        backups: {
          price: { hourly: 0.008, monthly: 5 },
          region_prices: [
            { id: "id-cgk", hourly: 0.009, monthly: 6 },
            { id: "br-gru", hourly: 0.01, monthly: 7 },
          ],
        },
      },
      memory: 4096,
      disk: 81920,
      transfer: 4000,
      vcpus: 2,
      gpus: 0,
      network_out: 4000,
      class: "dedicated",
      successor: null,
      capabilities: [],
      accelerated_devices: 0,
    },
    {
      id: "g1-gpu-rtx6000-1",
      label: "Dedicated 32GB + RTX6000 GPU x1",
      price: { hourly: 1.5, monthly: null },
      region_prices: [],
      addons: { backups: { price: { hourly: 0.06, monthly: 40 }, region_prices: [] } },
      memory: 32768,
      disk: 655360,
      transfer: 16000,
      vcpus: 8,
      gpus: 1,
      network_out: 10000,
      class: "gpu",
      successor: null,
      capabilities: [],
      accelerated_devices: 0,
    },
  ],
  page: 1,
  pages: 1,
  results: 3,
};

/** The two pages of the Linode availability (`GET /v4/regions/availability`). */
export const linodeAvailability = [
  {
    data: [
      { region: "us-central", plan: "g6-nanode-1", available: true },
      { region: "us-central", plan: "g6-dedicated-2", available: true },
      { region: "us-central", plan: "g1-gpu-rtx6000-1", available: false },
      { region: "us-east", plan: "g6-nanode-1", available: true },
      { region: "us-east", plan: "g6-dedicated-2", available: true },
      { region: "us-east", plan: "g1-gpu-rtx6000-1", available: false },
    ],
    page: 1,
    pages: 2,
    results: 12,
  },
  {
    data: [
      { region: "id-cgk", plan: "g6-nanode-1", available: true },
      { region: "id-cgk", plan: "g6-dedicated-2", available: false },
      { region: "id-cgk", plan: "g1-gpu-rtx6000-1", available: true },
      { region: "br-gru", plan: "g6-nanode-1", available: true },
      { region: "br-gru", plan: "g6-dedicated-2", available: true },
      { region: "br-gru", plan: "g1-gpu-rtx6000-1", available: false },
    ],
    page: 2,
    pages: 2,
    results: 12,
  },
];

/** A page of the Vultr list of places (`GET /v2/regions`), with no next page. */
export const vultrRegions = {
  regions: [
    { id: "ams", city: "Amsterdam", country: "NL", continent: "Europe", options: ["ddos_protection"] },
    { id: "ewr", city: "New Jersey", country: "US", continent: "North America", options: ["ddos_protection"] },
    { id: "sao", city: "São Paulo", country: "BR", continent: "South America", options: ["ddos_protection"] },
  ],
  meta: { total: 3, links: { next: "", prev: "" } },
};

/** A page of the Linode list of places (`GET /v4/regions`). The codes of the countries have small letters. */
export const linodeRegions = {
  data: [
    { id: "us-central", label: "Dallas, TX", country: "us", status: "ok", site_type: "core" },
    { id: "us-east", label: "Newark, NJ", country: "us", status: "ok", site_type: "core" },
    { id: "id-cgk", label: "Jakarta, ID", country: "id", status: "ok", site_type: "core" },
    { id: "br-gru", label: "Sao Paulo, BR", country: "br", status: "ok", site_type: "core" },
  ],
  page: 1,
  pages: 1,
  results: 4,
};
