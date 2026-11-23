// The SHA-256 every parsed file carries (design doc section 8, trust model): the browser hashes
// what it parsed, and the server checks the raw file it later receives has the same hash. Web
// Crypto exists in browsers and in Node, so both compute it with the same code.

/** The SHA-256 of the bytes, in lower-case hexadecimal. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Web Crypto refuses a view of shared memory; such bytes are copied first.
  const own =
    bytes.buffer instanceof ArrayBuffer ? (bytes as Uint8Array<ArrayBuffer>) : bytes.slice();
  const digest = await crypto.subtle.digest('SHA-256', own);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
