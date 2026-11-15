import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");

describe("the home page", () => {
  it("names the package and gives the install command", () => {
    expect(page).toContain("<title>market</title>");
    expect(page).toContain("pnpm add @mark1russell7/market");
  });

  it("links to the pages of site-pages and to the repository", () => {
    expect(page).toContain('href="./releases/"');
    expect(page).toContain('href="./status/"');
    expect(page).toContain('href="https://github.com/mark1russell7/market"');
  });

  it("has each element that the demo writes", () => {
    const script = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const ids = [...script.matchAll(/byId(?:<[^>]+>)?\("([a-z-]+)"\)/g)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThan(20);
    for (const id of new Set(ids)) expect(page, id).toContain(`id="${id}"`);
  });
});
