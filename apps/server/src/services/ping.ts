export interface PingResult {
  /** Gateway heartbeat latency, or null before the first heartbeat has been acknowledged. */
  gatewayMs: number | null;
}

/** discord.js reports -1 until the gateway has acknowledged a heartbeat. */
export function ping(input: { gatewayPingMs: number }): PingResult {
  const known = Number.isFinite(input.gatewayPingMs) && input.gatewayPingMs >= 0;
  return { gatewayMs: known ? Math.round(input.gatewayPingMs) : null };
}
