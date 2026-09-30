const PBKDF2_ITERATIONS = 600_000;
const HASH_LENGTH_BITS = 256;
const DUMMY_PASSWORD_HASH = "pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    HASH_LENGTH_BITS,
  );

  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${encodeBase64Url(salt)}$${encodeBase64Url(new Uint8Array(derivedBits))}`;
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/");
    const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const [algorithm, iterationsText, encodedSalt, encodedKey, extra] = encodedHash.split("$");
  const iterations = Number(iterationsText);
  const salt = decodeBase64Url(encodedSalt ?? "");
  const expectedKey = decodeBase64Url(encodedKey ?? "");
  if (
    extra !== undefined ||
    algorithm !== "pbkdf2-sha256" ||
    !Number.isInteger(iterations) ||
    iterations < 100_000 ||
    iterations > 1_000_000 ||
    !salt || salt.byteLength < 16 || salt.byteLength > 64 ||
    !expectedKey || expectedKey.byteLength !== HASH_LENGTH_BITS / 8
  ) {
    return false;
  }

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const cryptoSalt = new Uint8Array(new ArrayBuffer(salt.byteLength));
  cryptoSalt.set(salt);
  const actualKey = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: cryptoSalt, iterations },
    keyMaterial,
    HASH_LENGTH_BITS,
  ));
  let difference = 0;
  for (let index = 0; index < expectedKey.length; index += 1) {
    difference |= actualKey[index] ^ expectedKey[index];
  }
  return difference === 0;
}

export async function verifyPasswordOrDummy(password: string, encodedHash: string | null): Promise<boolean> {
  const matches = await verifyPassword(password, encodedHash ?? DUMMY_PASSWORD_HASH);
  return encodedHash === null ? false : matches;
}