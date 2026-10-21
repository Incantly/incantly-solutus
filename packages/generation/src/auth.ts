import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Learner tokens for the generation service. The host's own backend, which
 * knows who the learner is, mints a short-lived token signed with a secret it
 * shares with the service; the browser sends it as a bearer token. The token
 * carries only an opaque learner id and an expiry.
 */

export interface Learner {
  /** Opaque and stable: limits and spend are counted per learner. */
  readonly id: string;
}

export type Authenticator = (token: string) => Learner | null;

const LEARNER_ID = /^[\w-]{1,64}$/;

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** A token for `learnerId`, valid for `ttlSeconds`. */
export function mintToken(secret: string, learnerId: string, ttlSeconds = 3600, now: number = Date.now()): string {
  if (!LEARNER_ID.test(learnerId)) throw new Error('A learner id is 1 to 64 letters, digits, - or _');
  const payload = `${learnerId}.${Math.floor(now / 1000) + ttlSeconds}`;
  return `${payload}.${sign(secret, payload)}`;
}

/** Accepts tokens minted with `secret` that have not expired. */
export function hmacAuthenticator(secret: string, now: () => number = () => Date.now()): Authenticator {
  if (secret.length < 32) throw new Error('The token secret must be at least 32 characters');
  return (token) => {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [id, expiry, signature] = parts as [string, string, string];
    if (!LEARNER_ID.test(id) || !/^\d{1,12}$/.test(expiry)) return null;
    const expected = Buffer.from(sign(secret, `${id}.${expiry}`));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    if (Number(expiry) * 1000 <= now()) return null;
    return { id };
  };
}
