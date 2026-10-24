import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { ScenePlan } from '@incantly/core';
import { validatePlan } from './plan';

/**
 * Repair tickets (RP-7). The service signs the plan and the fragments of
 * every scene it validates. A figure keeps its ticket in the note, so when it
 * hits a problem after it is live, it can ask for a background repair without
 * the service keeping a copy of it, and nobody can put text of their own into
 * a repair prompt: the fragments must be the ones the service signed.
 *
 *   ticket = base64url(JSON { v: 1, plan, fragments: sha256 }) "." base64url(HMAC-SHA256)
 */

export interface TicketFragments {
  readonly html: string;
  readonly css: string;
  readonly js: string;
}

/** Longest ticket accepted: a plan of a few kilobytes, encoded. */
export const MAX_TICKET_LENGTH = 16_000;

const MIN_SECRET_LENGTH = 32;

function digest(fragments: TicketFragments): string {
  return createHash('sha256').update(JSON.stringify({ html: fragments.html, css: fragments.css, js: fragments.js })).digest('base64url');
}

function mac(secret: string, payload: string): Buffer {
  return createHmac('sha256', secret).update(`incantly-repair-ticket:${payload}`).digest();
}

function checkSecret(secret: string): void {
  if (typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) throw new Error(`A ticket secret needs at least ${MIN_SECRET_LENGTH} characters`);
}

/** Signs a validated scene's plan and fragments. */
export function issueTicket(secret: string, plan: ScenePlan, fragments: TicketFragments): string {
  checkSecret(secret);
  const payload = Buffer.from(JSON.stringify({ v: 1, plan, fragments: digest(fragments) }), 'utf8').toString('base64url');
  return `${payload}.${mac(secret, payload).toString('base64url')}`;
}

/** The plan a ticket signed, when it signed exactly these fragments; null otherwise. */
export function readTicket(secret: string, ticket: unknown, fragments: TicketFragments): ScenePlan | null {
  checkSecret(secret);
  if (typeof ticket !== 'string' || ticket.length > MAX_TICKET_LENGTH) return null;
  const dot = ticket.indexOf('.');
  if (dot <= 0 || dot !== ticket.lastIndexOf('.')) return null;
  const payload = ticket.slice(0, dot);
  if (!/^[\w-]+$/.test(payload) || !/^[\w-]+$/.test(ticket.slice(dot + 1))) return null;
  const given = Buffer.from(ticket.slice(dot + 1), 'base64url');
  const expected = mac(secret, payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let body: { v?: unknown; plan?: unknown; fragments?: unknown };
  try {
    body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as typeof body;
  } catch {
    return null;
  }
  if (body.v !== 1 || body.fragments !== digest(fragments)) return null;
  // Signed by this service, and still a plan the pipeline accepts.
  return validatePlan(body.plan).plan;
}
