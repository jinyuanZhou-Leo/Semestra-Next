/**
 * A random 128-bit id as 32 hex characters. `crypto.randomUUID` exists only in a secure context
 * (https or localhost), so a self-hosted instance opened at `http://<LAN address>` would fail with
 * it; `getRandomValues` works everywhere.
 */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
