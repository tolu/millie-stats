// Signed session tokens.
//
// A token is `<expiry-ms>.<base64url hmac>`. There is no session store and
// nothing secret inside it — the cookie only asserts "someone knew the
// passphrase, and that claim is good until this instant". The signature is
// what makes the expiry unforgeable.
//
// HMAC-SHA256 via WebCrypto, which exists in both workerd and Node, so this
// is testable without a runtime shim. crypto.subtle.verify compares in
// constant time; never hand-roll that with ===.

const ALGORITHM = { name: "HMAC", hash: "SHA-256" } as const;

async function keyFor(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    ALGORITHM,
    false,
    ["sign", "verify"],
  );
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(padded);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function createToken(
  secret: string,
  ttlMs: number,
  now: number = Date.now(),
): Promise<string> {
  const expiry = String(now + ttlMs);
  const signature = await crypto.subtle.sign(
    ALGORITHM,
    await keyFor(secret),
    new TextEncoder().encode(expiry),
  );
  return `${expiry}.${toBase64Url(signature)}`;
}

export async function verifyToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): Promise<boolean> {
  const separator = token.indexOf(".");
  if (separator <= 0) return false;

  const expiry = token.slice(0, separator);
  const signature = fromBase64Url(token.slice(separator + 1));
  if (!signature) return false;
  if (!/^\d+$/.test(expiry)) return false;

  // Signature first, then expiry: an attacker must not learn whether a forged
  // token had a plausible timestamp.
  const valid = await crypto.subtle.verify(
    ALGORITHM,
    await keyFor(secret),
    signature as unknown as BufferSource,
    new TextEncoder().encode(expiry),
  );
  if (!valid) return false;
  return Number(expiry) > now;
}

/** Reads one cookie out of a Cookie header without a parser dependency. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}
