const AUTO_LOAD_ROM_BASE = "/roms";

export const AUTO_LOAD_ROM_UNAVAILABLE_MESSAGE =
  "No local ROM ZIPs found under /roms. Use Load ROMs or create packages/web/public/roms/ with marble.zip and atarisy1.zip.";

const ROM_ZIP_NAMES = ["marble.zip", "atarisy1.zip"] as const;

export class AutoLoadRomUnavailableError extends Error {
  constructor(message = AUTO_LOAD_ROM_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = "AutoLoadRomUnavailableError";
  }
}

export function isAutoLoadRomUnavailableError(error: unknown): error is AutoLoadRomUnavailableError {
  return error instanceof AutoLoadRomUnavailableError;
}

function hasZipMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (
      (bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08)
    )
  );
}

function formatAutoLoadPath(name: string): string {
  return `${AUTO_LOAD_ROM_BASE}/${name}`;
}

export async function fetchAutoLoadRomZip(
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<File> {
  const path = formatAutoLoadPath(name);
  const response = await fetchImpl(path);
  if (!response.ok) {
    throw new AutoLoadRomUnavailableError();
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!hasZipMagic(bytes)) {
    throw new AutoLoadRomUnavailableError();
  }

  return new File([bytes], name, { type: "application/zip" });
}

export async function fetchAutoLoadRomZips(fetchImpl: typeof fetch = fetch): Promise<File[]> {
  return Promise.all(ROM_ZIP_NAMES.map((name) => fetchAutoLoadRomZip(name, fetchImpl)));
}

