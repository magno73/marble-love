/**
 * public-base-url.ts - resolve public-asset paths against Vite's base URL.
 *
 * The app is deployed both at the dev-server root ("/") and under a subpath
 * (GitHub Pages project sites, base "./"). Absolute "/scenarios/..." fetches
 * break under a subpath, so every fetch of a public asset goes through
 * publicUrl() to stay base-relative.
 */

export function publicUrl(
  path: string,
  baseUrl: string = import.meta.env.BASE_URL ?? "/",
): string {
  const relative = path.startsWith("/") ? path.slice(1) : path;
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${base}${relative}`;
}
