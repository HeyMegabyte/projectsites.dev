import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock localStorage before importing the module
const mockStorage = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => mockStorage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => mockStorage.set(key, value)),
  removeItem: vi.fn((key: string) => mockStorage.delete(key)),
  clear: vi.fn(() => mockStorage.clear()),
  get length() {
    return mockStorage.size;
  },
  key: vi.fn((_index: number) => null),
};

vi.stubGlobal('localStorage', localStorageMock);

// Mock fetch for testS3Connection
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Now import the module
const { s3Connection, updateS3Connection, disconnectS3, testS3Connection } = await import('./s3');

beforeEach(() => {
  mockStorage.clear();
  vi.clearAllMocks();

  // Reset store to default state
  s3Connection.set({
    provider: 'r2',
    endpoint: '',
    bucket: '',
    accessKeyId: '',
    secretAccessKey: '',
    region: 'auto',
    pathPrefix: '',
    customDomain: '',
    connected: false,
  });
});

describe('s3Connection store — default state', () => {
  it('has correct default values', () => {
    const state = s3Connection.get();
    expect(state.provider).toBe('r2');
    expect(state.endpoint).toBe('');
    expect(state.bucket).toBe('');
    expect(state.accessKeyId).toBe('');
    expect(state.secretAccessKey).toBe('');
    expect(state.region).toBe('auto');
    expect(state.pathPrefix).toBe('');
    expect(state.customDomain).toBe('');
    expect(state.connected).toBe(false);
  });
});

describe('updateS3Connection', () => {
  it('updates partial fields', () => {
    updateS3Connection({ endpoint: 'https://s3.amazonaws.com', bucket: 'my-bucket' });

    const state = s3Connection.get();
    expect(state.endpoint).toBe('https://s3.amazonaws.com');
    expect(state.bucket).toBe('my-bucket');

    // Other fields remain default
    expect(state.provider).toBe('r2');
    expect(state.connected).toBe(false);
  });

  it('persists to localStorage', () => {
    updateS3Connection({ provider: 's3', bucket: 'test' });

    expect(localStorageMock.setItem).toHaveBeenCalledWith('s3_connection', expect.stringContaining('"bucket":"test"'));
  });

  it('merges updates cumulatively', () => {
    updateS3Connection({ endpoint: 'https://example.com' });
    updateS3Connection({ bucket: 'my-bucket' });
    updateS3Connection({ connected: true });

    const state = s3Connection.get();
    expect(state.endpoint).toBe('https://example.com');
    expect(state.bucket).toBe('my-bucket');
    expect(state.connected).toBe(true);
  });

  it('handles localStorage errors gracefully', () => {
    localStorageMock.setItem.mockImplementationOnce(() => {
      throw new Error('QuotaExceeded');
    });

    // Should not throw
    expect(() => updateS3Connection({ bucket: 'test' })).not.toThrow();
    expect(s3Connection.get().bucket).toBe('test'); // State still updated in memory
  });
});

describe('disconnectS3', () => {
  it('resets all fields to default', () => {
    updateS3Connection({
      provider: 's3',
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'my-bucket',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      connected: true,
    });

    disconnectS3();

    const state = s3Connection.get();
    expect(state.provider).toBe('r2');
    expect(state.endpoint).toBe('');
    expect(state.bucket).toBe('');
    expect(state.accessKeyId).toBe('');
    expect(state.secretAccessKey).toBe('');
    expect(state.connected).toBe(false);
  });

  it('removes from localStorage', () => {
    updateS3Connection({ bucket: 'test' });
    disconnectS3();

    expect(localStorageMock.removeItem).toHaveBeenCalledWith('s3_connection');
  });

  it('handles localStorage errors gracefully', () => {
    localStorageMock.removeItem.mockImplementationOnce(() => {
      throw new Error('Not allowed');
    });

    expect(() => disconnectS3()).not.toThrow();
  });
});

describe('testS3Connection', () => {
  it('calls /api/s3-deploy with test action', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const conn = {
      ...s3Connection.get(),
      provider: 's3' as const,
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'test-bucket',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1',
    };

    const result = await testS3Connection(conn);

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/s3-deploy');
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body);
    expect(body.action).toBe('test');
    expect(body.provider).toBe('s3');
    expect(body.bucket).toBe('test-bucket');
  });

  it('returns error from API', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: 'AccessDenied' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const conn = {
      ...s3Connection.get(),
      endpoint: 'https://s3.amazonaws.com',
      bucket: 'test',
      accessKeyId: 'bad',
      secretAccessKey: 'creds',
      region: 'us-east-1',
    };

    const result = await testS3Connection(conn);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('AccessDenied');
  });

  it('handles network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

    const conn = {
      ...s3Connection.get(),
      endpoint: 'https://unreachable.example.com',
      bucket: 'test',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1',
    };

    const result = await testS3Connection(conn);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('fetch failed');
  });

  it('handles non-Error exceptions', async () => {
    mockFetch.mockRejectedValueOnce('string error');

    const conn = {
      ...s3Connection.get(),
      endpoint: 'https://example.com',
      bucket: 'test',
      accessKeyId: 'AKID',
      secretAccessKey: 'secret',
      region: 'us-east-1',
    };

    const result = await testS3Connection(conn);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Connection failed');
  });
});
