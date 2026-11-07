/* Screenshots for the README: node scripts/readme-shots.mjs [baseUrl] */
import { chromium } from "playwright-core";
const base = process.argv[2] ?? "http://localhost:8787";
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const p = await b.newPage({ viewport: { width: 1360, height: 820 }, deviceScaleFactor: 2 });
for (const [name, path] of [["triage", "/triage"], ["queue", "/"], ["board", "/board"], ["item", "/item/bl_017"], ["shipped", "/shipped"]]) {
  await p.goto(base + path, { waitUntil: "networkidle" });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `docs/screens/${name}.png` });
}
await b.close();
