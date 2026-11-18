/* The Worker's routing and safety rules, apart from worker.ts so tests can import them (worker.ts imports .sql files). */

/** A built file (script, style, image, font) rather than a page or an API call. */
export const isFile = (path: string) => path.startsWith("/assets/") || path.startsWith("/avatars/") || /\.[a-z0-9]{2,5}$/i.test(path);

/** The two databases must differ: the demo is reset every night. */
export function sameDatabase(a?: string, b?: string): boolean {
  return Boolean(a && b && a.trim() === b.trim());
}
