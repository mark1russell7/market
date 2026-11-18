import { describe, expect, it } from "vitest";
import { failure, fakePace, fakeTransport, reply } from "../test/fakes.ts";
import { linodeAvailability, linodeTypes, vultrPlans } from "../test/plan-fixtures.ts";
import { instantOf, type Exchange, type Reply } from "./client.ts";
import { createPlanClient, PLAN_PAGE_LIMIT } from "./plans-client.ts";
import { parsePlanLists } from "./plans.ts";
import { LINODE_PLANS, VULTR_PLANS } from "./providers.ts";

function setup(handler: (exchange: Exchange, index: number) => Reply | Error) {
  const { pace, clock } = fakePace();
  const { transport, sent } = fakeTransport(clock, handler);
  return { client: createPlanClient({ transport, pace }), sent, clock };
}

const LINODE_TYPES = "https://api.linode.com/v4/linode/types?page_size=500";
const LINODE_REGIONS = "https://api.linode.com/v4/regions/availability?page_size=500";

function linode(exchange: Exchange): Reply {
  if (exchange.url === LINODE_TYPES) return reply(200, linodeTypes);
  if (exchange.url === LINODE_REGIONS) return reply(200, linodeAvailability[0]);
  if (exchange.url === `${LINODE_REGIONS}&page=2`) return reply(200, linodeAvailability[1]);
  return reply(404, { errors: [{ reason: "Not found" }] });
}

describe("createPlanClient", () => {
  it("reads each page of the plan list and of the list of regions, with no key, 2 s apart, and parses them", async () => {
    const { client, sent, clock } = setup(linode);
    const result = await client.plans(LINODE_PLANS);
    expect(result).toEqual(parsePlanLists(LINODE_PLANS, { plans: [linodeTypes], regions: linodeAvailability }, instantOf(clock.now())));
    expect(sent.map(({ exchange }) => exchange)).toEqual(
      [LINODE_TYPES, LINODE_REGIONS, `${LINODE_REGIONS}&page=2`].map((url) => ({
        method: "GET",
        url,
        headers: { accept: "application/json" },
        body: null,
      })),
    );
    for (let index = 1; index < sent.length; index += 1) {
      expect((sent[index]?.at ?? 0) - (sent[index - 1]?.at ?? 0)).toBeGreaterThanOrEqual(LINODE_PLANS.paceMs);
    }
  });

  it("follows the cursor of each page of a Vultr list up to an empty cursor", async () => {
    const first = { ...vultrPlans, plans: vultrPlans.plans.slice(0, 1), meta: { total: 3, links: { next: "bmV4dA==", prev: "" } } };
    const second = { ...vultrPlans, plans: vultrPlans.plans.slice(1) };
    const { client, sent, clock } = setup((_exchange, index) => reply(200, index === 0 ? first : second));
    const result = await client.plans(VULTR_PLANS);
    expect(sent.map(({ exchange }) => exchange.url)).toEqual([
      "https://api.vultr.com/v2/plans?per_page=500",
      "https://api.vultr.com/v2/plans?per_page=500&cursor=bmV4dA%3D%3D",
    ]);
    expect(result).toEqual(parsePlanLists(VULTR_PLANS, { plans: [first, second] }, instantOf(clock.now())));
  });

  it("refuses a list that gives one cursor again, and a list with more pages than the limit", async () => {
    const loop = { ...vultrPlans, meta: { total: 3, links: { next: "same", prev: "" } } };
    const repeated = setup(() => reply(200, loop));
    expect(await repeated.client.plans(VULTR_PLANS)).toEqual({ ok: false, problems: ["The read stops: the plan list gives the cursor of its page 2 again."] });
    expect(repeated.sent).toHaveLength(2);
    const limited = setup(linode);
    expect(await limited.client.plans(LINODE_PLANS, { pages: 1 })).toEqual({
      ok: false,
      problems: ["The read stops: the list of regions has more pages than the limit of 1."],
    });
  });

  it("refuses a list whose page has no valid paging field, and sends no next request", async () => {
    const { client, sent } = setup((exchange) => (exchange.url === LINODE_REGIONS ? reply(200, { ...(linodeAvailability[0] as object), pages: "2" }) : linode(exchange)));
    expect(await client.plans(LINODE_PLANS)).toEqual({
      ok: false,
      problems: [`The read stops at the page 1 of the list of regions. The count of pages "2" at "pages" is not a whole number.`],
    });
    expect(sent).toHaveLength(2);
  });

  it("gives the problem of an answer that is not a success, and sends no next request", async () => {
    const { client, sent } = setup(() => reply(400, { errors: [{ reason: "detail" }] }, {}, "Bad Request"));
    expect(await client.plans(LINODE_PLANS)).toEqual({ ok: false, problems: ["Linode answered 400 Bad Request to the plan list."] });
    expect(sent).toHaveLength(1);
  });

  it("refuses a record that is not valid and a count of pages out of its range, before a request", async () => {
    const { client, sent } = setup(linode);
    expect((await failure(client.plans({ ...LINODE_PLANS, host: "api linode" }))).name).toBe("RangeError");
    expect((await failure(client.plans(LINODE_PLANS, { pages: PLAN_PAGE_LIMIT + 1 }))).message).toBe(
      `The count of pages is not a whole number from 1 to ${PLAN_PAGE_LIMIT}.`,
    );
    expect(sent).toEqual([]);
  });
});
