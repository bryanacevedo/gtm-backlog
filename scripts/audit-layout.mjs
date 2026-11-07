/* Layout audit: loads every view in a real browser and measures alignment
   instead of eyeballing it. Fails on:
   - columns whose header and cells do not share an edge (left or right, per alignment)
   - cells in one row whose text baselines differ by more than 1px
   - content inside .page that starts left of the shared content edge
   - anything wider than the viewport (horizontal scroll)
   Usage: node scripts/audit-layout.mjs [baseUrl]   (server must be running) */

import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:8787";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pages = ["/", "/board", "/triage", "/shipped", "/item/bl_002", "/item/bl_017", "/item/bl_014"];
// 330px approximates a 412px phone with system text enlarged about 125%.
const widths = [1440, 1024, 412, 360, 330];

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? CHROME });
let problems = 0;

for (const width of widths) {
  const phone = width < 500;
  const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
  for (const path of pages) {
    await page.goto(base + path, { waitUntil: "networkidle" });
    await page.waitForSelector(".page-head, .item-head, .inbox-head, .empty", { timeout: 8000 });
    const found = await page.evaluate(() => {
      const out = [];
      const r = (el) => el.getBoundingClientRect();
      const baseline = (el) => {
        // Baseline of the first rendered text: wrap that text node in an inline span
        // holding a zero-size marker, so flex and grid parents cannot move the marker.
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.textContent.trim() && n.parentElement.getClientRects().length ? 1 : 3 });
        const t = w.nextNode();
        if (!t) return r(el).bottom;
        const wrap = document.createElement("span");
        const m = document.createElement("span");
        m.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
        t.parentNode.insertBefore(wrap, t); wrap.appendChild(m); wrap.appendChild(t);
        const y = m.getBoundingClientRect().top;
        wrap.parentNode.insertBefore(t, wrap); wrap.remove();
        return y;
      };
      const visible = (el) => { const b = r(el); return b.width > 0 && b.height > 0 && getComputedStyle(el).display !== "none"; };

      // 1. Table column edges and row baselines.
      for (const t of document.querySelectorAll("table.grid")) {
        const ths = [...t.querySelectorAll("thead th")];
        const rows = [...t.querySelectorAll("tbody tr")];
        ths.forEach((th, i) => {
          if (!visible(th)) return;
          const right = getComputedStyle(th).textAlign === "right";
          const pad = (el) => parseFloat(getComputedStyle(el)[right ? "paddingRight" : "paddingLeft"]);
          const hx = right ? r(th).right - pad(th) : r(th).left + pad(th);
          for (const tr of rows) {
            const td = tr.children[i];
            if (!td || !visible(td)) continue;
            const kids = [...td.childNodes].filter((n) => n.nodeType === 1 || n.textContent.trim());
            if (!kids.length) continue;
            const range = document.createRange(); range.selectNodeContents(td);
            const rects = [...range.getClientRects()].filter((x) => x.width > 0);
            if (!rects.length) continue;
            const cx = right ? Math.max(...rects.map((x) => x.right)) : Math.min(...rects.map((x) => x.left));
            if (Math.abs(cx - hx) > 1) { out.push(`column "${th.textContent.trim()}" ${right ? "right" : "left"} edge off by ${Math.round(cx - hx)}px (row ${tr.dataset.row})`); break; }
          }
        });
        for (const tr of rows) {
          const ys = [...tr.children].filter(visible).filter((td) => td.textContent.trim()).map(baseline);
          const spread = Math.max(...ys) - Math.min(...ys);
          if (spread > 1) { out.push(`row ${tr.dataset.row}: cell baselines differ by ${spread.toFixed(1)}px`); break; }
        }
      }

      // 2. Row-like layouts: every direct child's first baseline must match.
      for (const sel of [".ship-row", ".log-row", ".feed-row", ".col-head", ".month-head", ".sect-head", ".meters", ".score-row", ".card .eyebrow", ".props", ".inbox-head", ".decision-head", ".req", ".page-head", ".move-bar"]) {
        for (const row of document.querySelectorAll(sel)) {
          if (!visible(row)) continue;
          if (sel === ".props") {
            for (const p of row.querySelectorAll(".prop")) {
              const [dt, dd] = p.children;
              const a = baseline(dt), b = baseline(dd);
              if (Math.abs(a - b) > 1) { out.push(`details "${dt.textContent.trim()}": label and value baselines differ by ${(b - a).toFixed(1)}px`); break; }
            }
            continue;
          }
          const kids = [...row.children].filter(visible).filter((k) => k.textContent.trim() && !k.matches(".dot, .sr-only, .av, .actions, .btn, select"));
          if (kids.length < 2) continue;
          const narrow = innerWidth < 760 && (sel === ".ship-row");
          if (narrow) continue;
          const top0 = r(kids[0]).top;
          const ys = kids.filter((k) => Math.abs(r(k).top - top0) < 12).map(baseline);
          if (ys.length < 2) continue;
          const spread = Math.max(...ys) - Math.min(...ys);
          if (spread > 1.5) out.push(`${sel}: children baselines differ by ${spread.toFixed(1)}px ("${kids.map((k) => k.textContent.trim().slice(0, 14)).join(" | ")}")`);
        }
      }

      // 3. Shared content edge: section heads, tables, rows start at the page content edge.
      const pageEl = document.querySelector(".page");
      const edge = r(pageEl).left + parseFloat(getComputedStyle(pageEl).paddingLeft);
      if (pageEl.classList.contains("full")) return [...new Set(out)];
      for (const el of pageEl.querySelectorAll(".page-head, .sect-head, .month-head, .meters, .crumbs, .item-head, .board, .ship-row")) {
        if (!visible(el)) continue;
        const col = el.closest(".item-cols > div, .col");
        const dx = r(el).left - (col ? r(col).left : edge);
        if (Math.abs(dx) > 1) out.push(`${el.className.split(" ")[0]} starts ${Math.round(dx)}px off the content edge`);
      }

      // 4a. A table wider than the screen must scroll inside its own frame, with # and Request pinned.
      for (const w of document.querySelectorAll(".table-wrap")) {
        if (w.scrollWidth > w.clientWidth + 1) {
          if (getComputedStyle(w).overflowX !== "auto") out.push("wide table cannot be scrolled");
          const pinned = w.querySelector("thead th.pin-2");
          if (!pinned || getComputedStyle(pinned).position !== "sticky") out.push("wide table scrolls but the Request column is not pinned");
        }
      }
      // 4b. Spill: text running outside its own box (and not deliberately clipped with an ellipsis).
      for (const el of document.querySelectorAll(".meter, .prop dd, .prop dt, .card, .card *, .nav-link, .btn, .tab, .col-head, .ship-row > *, .log-row > *, .feed-row > *, .req, .in-row > *, .decide-rank, .decision-head, .page-head, .move-bar, td, th")) {
        if (!visible(el)) continue;
        const cs = getComputedStyle(el);
        if (cs.overflowX !== "visible" || el.closest(".table-wrap") && el.matches("td.title, td.title *")) continue;
        if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
          const kids = [...el.querySelectorAll("*")].filter((k) => getComputedStyle(k).textOverflow === "ellipsis");
          if (!kids.length) out.push(`text spills out of ${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} ("${el.textContent.trim().slice(0, 24)}"), ${el.scrollWidth - el.clientWidth}px over`);
        }
      }
      // 4. Horizontal overflow.
      if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page scrolls sideways: ${document.documentElement.scrollWidth}px wide in a ${innerWidth}px viewport`);
      return [...new Set(out)];
    });
    for (const f of found) { problems++; console.log(`${width}px ${path}  ${f}`); }
  }
  await page.close();
}
await browser.close();
console.log(problems ? `\n${problems} alignment problems.` : "Alignment audit passed: every column, row and section edge lines up.");
process.exit(problems ? 1 : 0);
