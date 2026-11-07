/* Screenshots of every view for design review: node scripts/shots.mjs [baseUrl] */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
mkdirSync("design/qa", { recursive: true });
const base = process.argv[2] ?? "http://localhost:8787";
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const shots = [["queue", "/", 1440], ["board", "/board", 1440], ["triage", "/triage", 1440], ["shipped", "/shipped", 1440], ["item", "/item/bl_002", 1440], ["item-live", "/item/bl_017", 1440], ["queue-phone", "/", 390], ["item-phone", "/item/bl_017", 390]];
for (const [name, path, w] of shots) {
  const p = await b.newPage({ viewport: { width: w, height: w > 500 ? 1000 : 844 }, deviceScaleFactor: w > 500 ? 1 : 2 });
  await p.goto(base + path, { waitUntil: "networkidle" });
  await p.screenshot({ path: `design/qa/${name}.png`, fullPage: w <= 500 });
  await p.close();
}
await b.close();
