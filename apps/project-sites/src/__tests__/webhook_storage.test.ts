jest.mock('../services/db.js', () => ({ supabaseQuery: jest.fn() }));

import { supabaseQuery } from '../services/db.js';
import {
  checkWebhookIdempotency,
  storeWebhookEvent,
  markWebhookProcessed,
} from '../services/webhook.js';

const mockQuery = supabaseQuery as jest.MockedFunction<typeof supabaseQuery>;

const mockDb = {
  url: 'https://test.supabase.co',
  headers: {
    apikey: 'test-key',
    Authorization: 'Bearer test-key',
    'Content-Type': 'application/json',
  },
  fetch: jest.fn(),
} as any;

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── checkWebhookIdempotency ─────────────────────────────────

describe('checkWebhookIdempotency', () => {
  it('returns isDuplicate:false when no existing event', async () => {
    mockQuery.mockResolvedValue({ data: [], error: null, status: 200 });

    const result = await checkWebhookIdempotency(mockDb, 'stripe', 'evt_123');

    expect(result.isDuplicate).toBe(false);
    expect(result.existingId).toBeUndefined();
  });

  it('returns isDuplicate:true with existingId when event exists', async () => {
    mockQuery.mockResolvedValue({
      data: [{ id: 'existing-uuid', status: 'processed' }],
      error: null,
      status: 200,
    });

    const result = await checkWebhookIdempotency(mockDb, 'stripe', 'evt_123');

    expect(result.isDuplicate).toBe(true);
    expect(result.existingId).toBe('existing-uuid');
  });

  it('queries webhook_events with provider and event_id', async () => {
    mockQuery.mockResolvedValue({ data: [], error: null, status: 200 });

    await checkWebhookIdempotency(mockDb, 'dub', 'evt_abc');

    expect(mockQuery).toHaveBeenCalledWith(
      mockDb,
      'webhook_events',
      expect.objectContaining({
        query: expect.stringContaining('provider=eq.dub'),
      }),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      mockDb,
      'webhook_events',
      expect.objectContaining({
        query: expect.stringContaining('event_id=eq.evt_abc'),
      }),
    );
  });
});

// ─── storeWebhookEvent ───────────────────────────────────────

describe('storeWebhookEvent', () => {
  it('returns id on successful insert', async () => {
    mockQuery.mockResolvedValue({
      data: [{ id: 'new-uuid-123' }],
      error: null,
      status: 201,
    });

    const result = await storeWebhookEvent(mockDb, {
      provider: 'stripe',
      event_id: 'evt_456',
      event_type: 'checkout.session.completed',
    });

    expect(result.id).toBe('new-uuid-123');
    expect(result.error).toBeNull();
  });

  it('returns error when DB fails', async () => {
    mockQuery.mockResolvedValue({
      data: null,
      error: 'Insert failed',
      status: 500,
    });

    const result = await storeWebhookEvent(mockDb, {
      provider: 'stripe',
      event_id: 'evt_789',
      event_type: 'payment_intent.succeeded',
    });

    expect(result.id).toBeNull();
    expect(result.error).toBe('Insert failed');
  });

  it('sets default status to received', async () => {
    mockQuery.mockResolvedValue({
      data: [{ id: 'some-id' }],
      error: null,
      status: 201,
    });

    await storeWebhookEvent(mockDb, {
      provider: 'stripe',
      event_id: 'evt_100',
      event_type: 'invoice.paid',
    });

    expect(mockQuery).toHaveBeenCalledWith(
      mockDb,
      'webhook_events',
      expect.objectContaining({
        body: expect.objectContaining({
          status: 'received',
        }),
      }),
    );
  });

  it('sets attempts to 0', async () => {
    mockQuery.mockResolvedValue({
      data: [{ id: 'some-id' }],
      error: null,
      status: 201,
    });

    await storeWebhookEvent(mockDb, {
      provider: 'lago',
      event_id: 'evt_200',
      event_type: 'subscription.created',
    });

    expect(mockQuery).toHaveBeenCalledWith(
      mockDb,
      'webhook_events',
      expect.objectContaining({
        body: expect.objectContaining({
          attempts: 0,
        }),
      }),
    );
  });
});

// ─── markWebhookProcessed ────────────────────────────────────

describe('markWebhookProcessed', () => {
  it('sets status to processed and processed_at', async () => {
    mockQuery.mockResolvedValue({ data: null, error: null, status: 204 });

    await markWebhookProcessed(mockDb, 'event-uuid-1', 'processed');

    expect(mockQuery).toHaveBeenCalledWith(
      mockDb,
      'webhook_events',
      expect.objectContaining({
        method: 'PATCH',
        query: 'id=eq.event-uuid-1',
        body: expect.objectContaining({
          status: 'processed',
          processed_at: expect.any(String),
        }),
      }),
    );
  });

  it('sets status to failed with error_message', async () => {
    mockQuery.mockResolvedValue({ data: null, error: null, status: 204 });

    await markWebhookProcessed(mockDb, 'event-uuid-2', 'failed', 'Something broke');

    expect(mockQuery).toHaveBeenCalledWith(
      mockDb,
      'webhook_events',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.objectContaining({
          status: 'failed',
          error_message: 'Something broke',
        }),
      }),
    );
  });

  it('defaults status to processed when not specified', async () => {
    mockQuery.mockResolvedValue({ data: null, error: null, status: 204 });

    await markWebhookProcessed(mockDb, 'event-uuid-3');

    expect(mockQuery).toHaveBeenCalledWith(
      mockDb,
      'webhook_events',
      expect.objectContaining({
        body: expect.objectContaining({
          status: 'processed',
        }),
      }),
    );
  });
});
