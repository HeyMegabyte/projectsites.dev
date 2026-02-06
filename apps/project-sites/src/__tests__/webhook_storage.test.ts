jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

import { dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';
import {
  checkWebhookIdempotency,
  storeWebhookEvent,
  markWebhookProcessed,
} from '../services/webhook.js';

const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;
const mockUpdate = dbUpdate as jest.MockedFunction<typeof dbUpdate>;

const mockDb = {} as D1Database;

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── checkWebhookIdempotency ─────────────────────────────────

describe('checkWebhookIdempotency', () => {
  it('returns isDuplicate:false when no existing event', async () => {
    mockQueryOne.mockResolvedValue(null);

    const result = await checkWebhookIdempotency(mockDb, 'stripe', 'evt_123');

    expect(result.isDuplicate).toBe(false);
    expect(result.existingId).toBeUndefined();
  });

  it('returns isDuplicate:true with existingId when event exists', async () => {
    mockQueryOne.mockResolvedValue({ id: 'existing-uuid', status: 'processed' });

    const result = await checkWebhookIdempotency(mockDb, 'stripe', 'evt_123');

    expect(result.isDuplicate).toBe(true);
    expect(result.existingId).toBe('existing-uuid');
  });

  it('queries webhook_events with provider and event_id', async () => {
    mockQueryOne.mockResolvedValue(null);

    await checkWebhookIdempotency(mockDb, 'dub', 'evt_abc');

    expect(mockQueryOne).toHaveBeenCalledWith(
      mockDb,
      expect.stringContaining('provider = ?'),
      expect.arrayContaining(['dub', 'evt_abc']),
    );
  });
});

// ─── storeWebhookEvent ───────────────────────────────────────

describe('storeWebhookEvent', () => {
  it('returns id on successful insert', async () => {
    mockInsert.mockResolvedValue({ error: null });

    const result = await storeWebhookEvent(mockDb, {
      provider: 'stripe',
      event_id: 'evt_456',
      event_type: 'checkout.session.completed',
    });

    expect(result.id).toBeTruthy();
    expect(result.error).toBeNull();
  });

  it('returns error when DB fails', async () => {
    mockInsert.mockResolvedValue({ error: 'Insert failed' });

    const result = await storeWebhookEvent(mockDb, {
      provider: 'stripe',
      event_id: 'evt_789',
      event_type: 'payment_intent.succeeded',
    });

    expect(result.id).toBeNull();
    expect(result.error).toBe('Insert failed');
  });

  it('sets default status to received', async () => {
    mockInsert.mockResolvedValue({ error: null });

    await storeWebhookEvent(mockDb, {
      provider: 'stripe',
      event_id: 'evt_100',
      event_type: 'invoice.paid',
    });

    expect(mockInsert).toHaveBeenCalledWith(
      mockDb,
      'webhook_events',
      expect.objectContaining({
        status: 'received',
      }),
    );
  });

  it('sets attempts to 0', async () => {
    mockInsert.mockResolvedValue({ error: null });

    await storeWebhookEvent(mockDb, {
      provider: 'lago',
      event_id: 'evt_200',
      event_type: 'subscription.created',
    });

    expect(mockInsert).toHaveBeenCalledWith(
      mockDb,
      'webhook_events',
      expect.objectContaining({
        attempts: 0,
      }),
    );
  });
});

// ─── markWebhookProcessed ────────────────────────────────────

describe('markWebhookProcessed', () => {
  it('sets status to processed and processed_at', async () => {
    mockUpdate.mockResolvedValue({ error: null, changes: 1 });

    await markWebhookProcessed(mockDb, 'event-uuid-1', 'processed');

    expect(mockUpdate).toHaveBeenCalledWith(
      mockDb,
      'webhook_events',
      expect.objectContaining({
        status: 'processed',
        processed_at: expect.any(String),
      }),
      'id = ?',
      ['event-uuid-1'],
    );
  });

  it('sets status to failed with error_message', async () => {
    mockUpdate.mockResolvedValue({ error: null, changes: 1 });

    await markWebhookProcessed(mockDb, 'event-uuid-2', 'failed', 'Something broke');

    expect(mockUpdate).toHaveBeenCalledWith(
      mockDb,
      'webhook_events',
      expect.objectContaining({
        status: 'failed',
        error_message: 'Something broke',
      }),
      'id = ?',
      ['event-uuid-2'],
    );
  });

  it('defaults status to processed when not specified', async () => {
    mockUpdate.mockResolvedValue({ error: null, changes: 1 });

    await markWebhookProcessed(mockDb, 'event-uuid-3');

    expect(mockUpdate).toHaveBeenCalledWith(
      mockDb,
      'webhook_events',
      expect.objectContaining({
        status: 'processed',
      }),
      'id = ?',
      ['event-uuid-3'],
    );
  });
});
