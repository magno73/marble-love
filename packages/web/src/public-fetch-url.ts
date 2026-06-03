export interface PublicFetchPathOptions {
  readonly allowedPrefixes: readonly string[];
  readonly paramName: string;
}

function normalizePrefix(prefix: string): string {
  const withoutLeadingSlash = prefix.startsWith("/") ? prefix.slice(1) : prefix;
  return withoutLeadingSlash.endsWith("/") ? withoutLeadingSlash : `${withoutLeadingSlash}/`;
}

export function normalizePublicFetchPath(raw: string, options: PublicFetchPathOptions): string {
  const value = raw.trim();
  if (value === "") {
    throw new Error(`${options.paramName} must not be empty`);
  }

  if (
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    /%[0-9a-f]{2}/i.test(value)
  ) {
    throw new Error(`${options.paramName} must be a same-origin public path`);
  }

  const withoutLeadingSlash = value.startsWith("/") ? value.slice(1) : value;
  const parts = withoutLeadingSlash.split("/");
  if (
    withoutLeadingSlash.startsWith("/") ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${options.paramName} must not contain empty or traversal path segments`);
  }

  const prefixes = options.allowedPrefixes.map(normalizePrefix);
  if (!prefixes.some((prefix) => withoutLeadingSlash.startsWith(prefix))) {
    throw new Error(
      `${options.paramName} must be under one of: ${options.allowedPrefixes.join(", ")}`,
    );
  }

  return `/${withoutLeadingSlash}`;
}

export function optionalPublicFetchPath(
  raw: string | null,
  fallback: string,
  options: PublicFetchPathOptions,
): string {
  return normalizePublicFetchPath(raw ?? fallback, options);
}
