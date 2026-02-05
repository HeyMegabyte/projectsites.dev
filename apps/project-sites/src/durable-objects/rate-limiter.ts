/**
 * Rate Limiter Durable Object
 * Provides distributed rate limiting across workers
 */

interface RateLimitState {
  count: number;
  windowStart: number;
}

export class RateLimiter implements DurableObject {
  private state: DurableObjectState;
  private limits: Map<string, RateLimitState> = new Map();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/check') {
      return this.handleCheck(request);
    }

    if (request.method === 'POST' && url.pathname === '/reset') {
      return this.handleReset(request);
    }

    return new Response('Not Found', { status: 404 });
  }

  private async handleCheck(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      key: string;
      limit: number;
      windowSeconds: number;
    };

    const { key, limit, windowSeconds } = body;
    const now = Date.now();
    const windowMs = windowSeconds * 1000;

    // Get or create state
    let state = this.limits.get(key);

    if (!state || now - state.windowStart >= windowMs) {
      // New window
      state = { count: 0, windowStart: now };
    }

    // Check limit
    if (state.count >= limit) {
      const resetAt = state.windowStart + windowMs;
      const retryAfter = Math.ceil((resetAt - now) / 1000);

      return Response.json({
        allowed: false,
        remaining: 0,
        reset_at: new Date(resetAt).toISOString(),
        retry_after: retryAfter,
      });
    }

    // Increment and store
    state.count++;
    this.limits.set(key, state);

    // Persist to storage
    await this.state.storage.put(key, state);

    const resetAt = state.windowStart + windowMs;

    return Response.json({
      allowed: true,
      remaining: limit - state.count,
      reset_at: new Date(resetAt).toISOString(),
    });
  }

  private async handleReset(request: Request): Promise<Response> {
    const body = (await request.json()) as { key: string };

    this.limits.delete(body.key);
    await this.state.storage.delete(body.key);

    return Response.json({ success: true });
  }

  // Cleanup old entries periodically
  async alarm(): Promise<void> {
    const now = Date.now();
    const oneHourAgo = now - 3600000;

    for (const [key, state] of this.limits.entries()) {
      if (state.windowStart < oneHourAgo) {
        this.limits.delete(key);
        await this.state.storage.delete(key);
      }
    }
  }
}
