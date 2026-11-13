/* Constant-time string comparison in plain JS, so the same code runs on Node and on Cloudflare Workers.
   It always walks 512 bytes, so neither the content nor the length of the secret shows in the timing.
   Values longer than 512 bytes never match. */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  const n = 512;
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0 && x.length <= n;
}
