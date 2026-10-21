import { generate } from './generate.mjs';

/** Vitest global setup: make sure generated modules exist before any test imports them. */
export default async function setup() {
  await generate();
}
