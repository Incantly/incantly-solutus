/** Base64 of bytes, in our own code so the core needs neither `Buffer` nor `btoa`. Standard alphabet, with padding. */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const DECODE = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) DECODE[ALPHABET.charCodeAt(i)] = i;

export function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const n = bytes.length;
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i] as number;
    const b = i + 1 < n ? (bytes[i + 1] as number) : 0;
    const c = i + 2 < n ? (bytes[i + 2] as number) : 0;
    const word = (a << 16) | (b << 8) | c;
    parts.push(
      ALPHABET.charAt((word >> 18) & 63) + ALPHABET.charAt((word >> 12) & 63) + (i + 1 < n ? ALPHABET.charAt((word >> 6) & 63) : '=') + (i + 2 < n ? ALPHABET.charAt(word & 63) : '='),
    );
  }
  return parts.join('');
}

/** The bytes of a base64 text, or undefined when the text is not valid base64 (wrong length, character or padding). */
export function fromBase64(text: string): Uint8Array | undefined {
  const n = text.length;
  if (n % 4 !== 0) return undefined;
  const pad = n === 0 ? 0 : text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((n / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < n; i += 4) {
    let word = 0;
    for (let k = 0; k < 4; k++) {
      const code = text.charCodeAt(i + k);
      const isPad = code === 61 && i + k >= n - pad;
      const v = isPad ? 0 : code < 128 ? (DECODE[code] as number) : -1;
      if (v < 0) return undefined;
      word = (word << 6) | v;
    }
    if (o < out.length) out[o++] = (word >> 16) & 255;
    if (o < out.length) out[o++] = (word >> 8) & 255;
    if (o < out.length) out[o++] = word & 255;
  }
  return out;
}
