import { byId, copyText, setupTheme } from "@mark1russell7/site-pages/chrome";
import { drawChart, type ChartParts } from "./chart.ts";
import { SAMPLE_CODES } from "./demo-data.ts";
import { choiceOf, curveOf, gtinOf, hashOf, MAX_AGE, OFFERED_CONDITIONS, stateOf, termsOf, type DemoState } from "./demo.ts";

setupTheme(byId<HTMLButtonElement>("theme"), "theme");

const copy = byId<HTMLButtonElement>("copy");
copy.addEventListener("click", () => {
  void copyText(copy, byId("install").textContent ?? "");
});

/** The counts where an offer of the sample changes its unit price or starts. */
const BREAKS = [1, 10, 25, 50, 100];

const STOCK_TEXT: Record<string, string> = {
  "in-stock": "In stock",
  "low-stock": "Low stock",
  "out-of-stock": "Out of stock",
  preorder: "Preorder",
  unknown: "Not known",
};

let state: DemoState = stateOf(location.hash);

const part = byId<HTMLInputElement>("part");
const count = byId<HTMLInputElement>("count");
const countValue = byId<HTMLOutputElement>("count-value");
const quick = byId("quick");
const conds = byId("conds");
const code = byId<HTMLInputElement>("code");
const codes = byId("codes");
const age = byId<HTMLInputElement>("age");
const ageValue = byId<HTMLOutputElement>("age-value");
const ended = byId<HTMLInputElement>("ended");
const chart: ChartParts = { plot: byId("plot"), svg: byId("chart") as unknown as SVGSVGElement, tip: byId("tip"), legend: byId("legend") };

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className !== undefined) node.className = className;
  return node;
};

const swatch = (slot: number): HTMLElement => {
  const dot = element("span", undefined, "dot");
  dot.style.background = `var(--s${slot})`;
  return dot;
};

/** This function makes a cell of the table of offers. A narrow screen shows its label above its value. */
const cell = (label: string, text: string, className?: string): HTMLTableCellElement => {
  const td = element("td", text, className);
  td.dataset["label"] = label;
  return td;
};

for (const value of BREAKS) {
  const button = element("button", String(value));
  button.type = "button";
  button.dataset["count"] = String(value);
  button.addEventListener("click", () => update({ count: value }));
  quick.append(button);
}

for (const condition of OFFERED_CONDITIONS) {
  const label = element("label", undefined, "check-label");
  const box = element("input");
  box.type = "checkbox";
  box.value = condition;
  box.addEventListener("change", () => {
    const chosen = [...conds.querySelectorAll<HTMLInputElement>("input:checked")].map((each) => each.value);
    update({ conditions: OFFERED_CONDITIONS.filter((each) => chosen.includes(each)) });
  });
  label.append(box, document.createTextNode(` ${condition}`));
  conds.append(label);
}

for (const sample of SAMPLE_CODES) {
  const button = element("button", sample.name);
  button.type = "button";
  button.addEventListener("click", () => update({ code: sample.code }));
  codes.append(button);
}

part.addEventListener("input", () => update({ part: part.value }));
count.addEventListener("input", () => update({ count: Number(count.value) }));
code.addEventListener("input", () => update({ code: code.value }));
age.addEventListener("input", () => update({ age: Number(age.value) }));
ended.addEventListener("change", () => update({ ended: ended.checked }));
window.addEventListener("hashchange", () => {
  state = stateOf(location.hash);
  render();
});
new ResizeObserver(() => renderChart()).observe(chart.plot);

/** This function changes the state, keeps it in the address, and draws the page again. */
function update(change: Partial<DemoState>): void {
  state = { ...state, ...change };
  const hash = hashOf(state);
  history.replaceState(null, "", hash === "" ? `${location.pathname}${location.search}` : hash);
  render();
}

/** This function sets each control to the state. */
function syncControls(): void {
  // A text field with the focus keeps its text, so the cursor does not move while the visitor types.
  if (document.activeElement !== part) part.value = state.part;
  if (document.activeElement !== code) code.value = state.code;
  count.value = String(state.count);
  age.value = String(state.age);
  ended.checked = state.ended;
  countValue.textContent = String(state.count);
  ageValue.textContent = `${state.age} h`;
  for (const button of quick.querySelectorAll<HTMLButtonElement>("button")) button.setAttribute("aria-pressed", String(button.dataset["count"] === String(state.count)));
  for (const box of conds.querySelectorAll<HTMLInputElement>("input")) box.checked = state.conditions.includes(box.value as DemoState["conditions"][number]);
  for (const button of codes.querySelectorAll<HTMLButtonElement>("button")) {
    const sample = SAMPLE_CODES.find((each) => each.name === button.textContent);
    button.setAttribute("aria-pressed", String(sample?.code === state.code));
  }
}

function renderChoice(): void {
  const view = choiceOf(state);
  byId("verdict").textContent = view.verdict;
  byId("verdict").className = `verdict ${view.best === null ? "none" : view.best.inStock ? "good" : "warn"}`;
  byId("why").textContent = view.why;
  byId("why").hidden = view.why === "";

  const body = byId("offers");
  body.replaceChildren();
  for (const row of view.rows) {
    const tr = element("tr", undefined, row.best ? "best" : undefined);
    const offer = element("td");
    const name = element("span", undefined, "offer-name");
    name.append(swatch(row.slot), document.createTextNode(row.label));
    if (row.best) name.append(element("span", "Best", "chip"));
    offer.append(name, element("span", row.title, "offer-title"));
    tr.append(
      offer,
      cell("Condition", row.condition),
      cell("Stock", STOCK_TEXT[row.availability] ?? row.availability, row.inStock ? "stock in" : "stock out"),
      cell("Unit price", row.unitPrice, "num"),
      cell("Goods", row.goods, "num"),
      cell("Shipping", row.shipping, "num"),
      cell("Cost", row.cost, "num"),
    );
    body.append(tr);
  }
  byId("offers-empty").hidden = view.rows.length > 0;

  const skipped = byId("skipped");
  skipped.replaceChildren(
    ...view.skipped.map((row) => {
      const li = element("li");
      li.append(element("strong", row.label), element("span", row.why));
      return li;
    }),
  );
  byId("skipped-empty").hidden = view.skipped.length > 0;

  const other = byId("other");
  other.replaceChildren(
    ...view.other.map((row) => {
      const li = element("li");
      const ids = element("span");
      ids.append(document.createTextNode(`${row.title}. Brand `), element("code", row.brand), document.createTextNode(", part number "), element("code", row.partNumber), document.createTextNode("."));
      li.append(element("strong", row.label), ids);
      return li;
    }),
  );
  byId("other-empty").hidden = view.other.length > 0;
}

function renderChart(): void {
  drawChart(chart, curveOf(state), state.count, (value) => update({ count: value }));
}

function renderGtin(): void {
  const view = gtinOf(state.code);
  const digits = byId("digits");
  digits.replaceChildren();
  if (view.steps !== null) {
    for (const step of view.steps) {
      const box = element("span", undefined, `digit w${step.weight}`);
      box.append(element("b", String(step.digit)), element("small", `×${step.weight}`));
      digits.append(box);
    }
    const last = element("span", undefined, `digit last ${view.valid ? "good" : "bad"}`);
    last.append(element("b", String(view.given)), element("small", "check"));
    digits.append(last);
  }
  byId("sum").textContent = view.sum === null || view.expected === null ? "" : `The sum of the digits times their weights is ${view.sum}. The check digit is ${view.expected}: the sum plus it is a multiple of 10.`;
  const check = byId("check");
  check.replaceChildren(element("span", view.valid ? "✓" : "✗", "mark"), document.createTextNode(` ${view.why}`));
  check.className = `check ${view.valid ? "good" : "bad"}`;
  const keys = byId("keys");
  keys.replaceChildren();
  if (view.gtin14 !== null && view.key !== null) {
    keys.append(element("dt", "GTIN-14"), element("dd"), element("dt", "Match key"), element("dd"));
    const [, gtinValue, , keyValue] = [...keys.children];
    gtinValue?.append(element("code", view.gtin14));
    keyValue?.append(element("code", view.key));
  }
}

function renderTerms(): void {
  const list = byId("terms");
  list.replaceChildren(
    ...termsOf(state).map((row) => {
      const li = element("li", undefined, `card term ${row.kept ? "good" : "bad"}`);
      const head = element("div", undefined, "term-head");
      head.append(element("h3", row.name), element("span", row.kept ? "✓ Kept" : "✗ Not kept", "badge"));
      const bar = element("div", undefined, "bar");
      bar.setAttribute("aria-hidden", "true");
      const fill = element("span", undefined, "bar-fill");
      fill.style.width = `${row.keptFor === null ? 100 : (Math.min(row.keptFor, MAX_AGE) / MAX_AGE) * 100}%`;
      const marker = element("span", undefined, "bar-marker");
      marker.style.left = `${(state.age / MAX_AGE) * 100}%`;
      bar.append(fill, marker);
      const scale = element("div", undefined, "bar-scale");
      scale.setAttribute("aria-hidden", "true");
      scale.append(element("span", "0 h"), element("span", "24 h"), element("span", "48 h"));
      const facts = element("dl", undefined, "facts");
      for (const [name, value] of [
        ["Rule", row.rule],
        ["Keep until", row.until],
        ["A history", row.history ? "Permitted" : "Not permitted"],
        ["A trend", row.trend ? "Permitted" : "Not permitted"],
      ] as const) {
        facts.append(element("dt", name), element("dd", value));
      }
      li.append(head, bar, scale, element("p", row.why, "term-why"), facts);
      return li;
    }),
  );
}

function render(): void {
  syncControls();
  renderChoice();
  renderChart();
  renderGtin();
  renderTerms();
}

render();
