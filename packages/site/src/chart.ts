import { MAX_COUNT, type Curve, type Series } from "./demo.ts";

const NS = "http://www.w3.org/2000/svg";

/** This function makes an SVG element with its attributes, and adds it to the parent. */
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  parent.append(node);
  return node;
}

/** This function gives the unit price of a line at a count, or null when the offer does not take the count. */
export function priceAt(line: Series, count: number): number | null {
  return line.steps.find((step) => step.from <= count && count <= step.to)?.price ?? null;
}

/** This function gives the step of the ticks of the price axis: at most 5 ticks over the range. */
export function tickStep(low: number, high: number): number {
  const range = Math.max(high - low, 1);
  return [1, 2, 5, 10, 20, 25, 50, 100].find((step) => range / step <= 5) ?? 100;
}

const MONEY = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const WHOLE = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** The parts of the page that the chart writes. */
export interface ChartParts {
  readonly plot: HTMLElement;
  readonly svg: SVGSVGElement;
  readonly tip: HTMLElement;
  readonly legend: HTMLElement;
}

const colorOf = (slot: number): string => `var(--s${slot})`;

/** This function writes the legend of the chart: a swatch and a label for each offer. */
function writeLegend(legend: HTMLElement, curve: Curve): void {
  legend.replaceChildren();
  for (const line of curve.series) {
    const item = document.createElement("li");
    const swatch = document.createElementNS(NS, "svg");
    swatch.setAttribute("width", "20");
    swatch.setAttribute("height", "10");
    swatch.setAttribute("aria-hidden", "true");
    const mark = svg("line", { x1: 1, y1: 5, x2: 19, y2: 5, "stroke-width": 2.5, "stroke-linecap": "round" }, swatch);
    mark.style.stroke = colorOf(line.slot);
    if (!line.inStock) mark.setAttribute("stroke-dasharray", "4 3");
    item.append(swatch, document.createTextNode(line.inStock ? line.label : `${line.label} (not in stock)`));
    legend.append(item);
  }
}

/**
 * This function draws the chart of the unit price. It has a step line for each offer, the chosen count, and a band
 * with the best offer at each count. A click on the plot gives the count under the pointer to `onCount`.
 */
export function drawChart(parts: ChartParts, curve: Curve, count: number, onCount: (count: number) => void): void {
  const { plot, svg: root, tip, legend } = parts;
  writeLegend(legend, curve);
  root.replaceChildren();
  tip.hidden = true;
  const width = Math.max(plot.clientWidth, 280);
  const narrow = width < 520;
  const labelled = curve.series.length <= 4 && !narrow;
  const margin = { top: 24, right: labelled ? 104 : 14, bottom: 62, left: 46 };
  const height = narrow ? 260 : 300;
  root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  const left = margin.left;
  const right = width - margin.right;
  const top = margin.top;
  const bottom = height - margin.bottom;
  const step = tickStep(curve.low, curve.high);
  const yLow = Math.floor(curve.low / step) * step;
  const yHigh = Math.max(Math.ceil(curve.high / step) * step, yLow + step);
  const x = (c: number): number => left + ((c - 1) / (MAX_COUNT - 1)) * (right - left);
  const y = (price: number): number => bottom - ((price - yLow) / (yHigh - yLow)) * (bottom - top);
  const countAt = (px: number): number => Math.min(MAX_COUNT, Math.max(1, Math.round(1 + ((px - left) / (right - left)) * (MAX_COUNT - 1))));

  const grid = svg("g", { class: "grid" }, root);
  for (let value = yLow; value <= yHigh + 1e-9; value += step) {
    svg("line", { x1: left, x2: right, y1: y(value), y2: y(value) }, grid);
    svg("text", { x: left - 6, y: y(value), "text-anchor": "end", "dominant-baseline": "middle" }, grid).textContent = WHOLE.format(value);
  }
  for (const tick of [1, 20, 40, 60, 80, 100, 120]) {
    svg("text", { x: x(tick), y: bottom + 16, "text-anchor": "middle" }, grid).textContent = String(tick);
  }
  svg("line", { class: "axis", x1: left, x2: right, y1: bottom, y2: bottom }, root);

  if (curve.series.length === 0) {
    svg("text", { class: "empty", x: (left + right) / 2, y: (top + bottom) / 2, "text-anchor": "middle" }, root).textContent = "No offer takes an order.";
  }

  const lines = svg("g", { class: "lines" }, root);
  for (const line of curve.series) {
    let d = "";
    line.steps.forEach((each, i) => {
      const previous = line.steps[i - 1];
      const end = x(Math.min(each.to + 1, MAX_COUNT));
      d += previous !== undefined && previous.to + 1 === each.from ? ` V${y(each.price)} H${end}` : ` M${x(each.from)} ${y(each.price)} H${end}`;
    });
    const path = svg("path", { d: d.trim(), fill: "none", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, lines);
    path.style.stroke = colorOf(line.slot);
    if (!line.inStock) path.setAttribute("stroke-dasharray", "5 4");
  }

  if (labelled) {
    const placed = curve.series
      .map((line) => ({ line, at: y(priceAt(line, MAX_COUNT) ?? curve.low) }))
      .sort((a, b) => a.at - b.at);
    for (let i = 1; i < placed.length; i += 1) {
      const above = placed[i - 1];
      const here = placed[i];
      if (above !== undefined && here !== undefined && here.at - above.at < 14) here.at = above.at + 14;
    }
    const labels = svg("g", { class: "labels" }, root);
    for (const { line, at } of placed) svg("text", { x: right + 8, y: at, "dominant-baseline": "middle" }, labels).textContent = line.label;
  }

  const band = svg("g", { class: "band" }, root);
  const bandY = bottom + 30;
  svg("text", { class: "band-name", x: left - 6, y: bandY + 5, "text-anchor": "end", "dominant-baseline": "middle" }, band).textContent = "Best";
  const slotOf = new Map(curve.series.map((line) => [line.id, line.slot]));
  for (const run of curve.band) {
    const from = Math.max(left, x(run.from - 0.5)) + 1;
    const to = Math.min(right, x(run.to + 0.5)) - 1;
    const rect = svg("rect", { x: from, y: bandY, width: Math.max(to - from, 1), height: 10, rx: 2 }, band);
    if (run.id === null) rect.setAttribute("class", "none");
    else rect.style.fill = colorOf(slotOf.get(run.id) ?? 0);
  }

  const chosen = svg("g", { class: "chosen" }, root);
  // The line has a gap over the labels of the count axis, so it hides no label.
  svg("line", { x1: x(count), x2: x(count), y1: top - 6, y2: bottom }, chosen);
  svg("line", { x1: x(count), x2: x(count), y1: bottom + 22, y2: bandY + 12 }, chosen);
  svg("text", { x: x(count), y: top - 10, "text-anchor": x(count) > right - 40 ? "end" : x(count) < left + 40 ? "start" : "middle" }, chosen).textContent =
    count === 1 ? "1 unit" : `${count} units`;
  for (const line of curve.series) {
    const price = priceAt(line, count);
    if (price === null) continue;
    const dot = svg("circle", { cx: x(count), cy: y(price), r: 4.5, "stroke-width": 2 }, chosen);
    dot.style.fill = colorOf(line.slot);
  }

  const hover = svg("line", { class: "hover", x1: 0, x2: 0, y1: top, y2: bandY + 10, visibility: "hidden" }, root);
  const target = svg("rect", { class: "target", x: left - 8, y: top - 12, width: right - left + 16, height: bandY + 22 - top }, root);

  const showTip = (event: PointerEvent): void => {
    const box = root.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    const at = countAt(px);
    hover.setAttribute("x1", String(x(at)));
    hover.setAttribute("x2", String(x(at)));
    hover.setAttribute("visibility", "visible");
    const best = curve.band.find((run) => run.from <= at && at <= run.to)?.id ?? null;
    const rows = curve.series
      .map((line) => ({ line, price: priceAt(line, at) }))
      .filter((row): row is { line: Series; price: number } => row.price !== null)
      .sort((a, b) => a.price - b.price);
    tip.replaceChildren();
    const head = document.createElement("p");
    head.className = "tip-head";
    head.textContent = at === 1 ? "1 unit" : `${at} units`;
    tip.append(head);
    if (rows.length === 0) {
      const none = document.createElement("p");
      none.textContent = "No offer takes this count.";
      tip.append(none);
    }
    for (const { line, price } of rows) {
      const row = document.createElement("p");
      row.className = "tip-row";
      const swatch = document.createElement("span");
      swatch.className = "dot";
      swatch.style.background = colorOf(line.slot);
      const name = document.createElement("span");
      name.textContent = line.id === best ? `${line.label} · best` : line.inStock ? line.label : `${line.label} · not in stock`;
      const value = document.createElement("strong");
      value.textContent = MONEY.format(price);
      row.append(swatch, name, value);
      tip.append(row);
    }
    tip.hidden = false;
    const tipWidth = tip.offsetWidth;
    const pxOnPage = (x(at) / width) * box.width;
    const leftAt = pxOnPage + 14 + tipWidth > box.width ? pxOnPage - 14 - tipWidth : pxOnPage + 14;
    tip.style.left = `${Math.max(0, leftAt)}px`;
    tip.style.top = `${(top / height) * box.height}px`;
  };
  target.addEventListener("pointermove", showTip);
  target.addEventListener("pointerdown", showTip);
  target.addEventListener("pointerleave", () => {
    hover.setAttribute("visibility", "hidden");
    tip.hidden = true;
  });
  target.addEventListener("click", (event) => {
    const box = root.getBoundingClientRect();
    onCount(countAt(((event.clientX - box.left) / box.width) * width));
  });
}
