/**
 * GET /api/booking/deposit — the deposit rule configured in Beds24, so the
 * reservations page can show "to pay now / balance at the pension" before
 * the guest reaches payment. { ok: true, rule: null | { fixed, type, percentage } }
 * (null = the whole stay is paid at booking).
 */
import type { Config } from '@netlify/functions';
import { depositRule, errorResponse } from '../lib/booking';

export default async () => {
  try {
    const rule = await depositRule();
    return new Response(JSON.stringify({ ok: true, rule }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
    });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = { path: '/api/booking/deposit', method: 'GET' };
