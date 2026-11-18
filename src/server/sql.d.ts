/* wrangler bundles *.sql as text (see wrangler.toml). */
declare module "*.sql" {
  const text: string;
  export default text;
}
