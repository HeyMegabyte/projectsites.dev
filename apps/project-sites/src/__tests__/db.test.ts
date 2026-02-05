import { createServiceClient, createAnonClient, supabaseQuery, type SupabaseClient } from '../services/db.js';

const mockEnv = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
} as any;

describe('createServiceClient', () => {
  const client = createServiceClient(mockEnv);

  it('returns correct url', () => {
    expect(client.url).toBe('https://test.supabase.co');
  });

  it('includes service role key as apikey header', () => {
    expect(client.headers.apikey).toBe('test-service-key');
  });

  it('includes Authorization Bearer with service role key', () => {
    expect(client.headers.Authorization).toBe('Bearer test-service-key');
  });

  it('includes Content-Type application/json', () => {
    expect(client.headers['Content-Type']).toBe('application/json');
  });

  it('includes Prefer return=representation', () => {
    expect(client.headers.Prefer).toBe('return=representation');
  });

  it('has a fetch function', () => {
    expect(typeof client.fetch).toBe('function');
  });
});

describe('createAnonClient', () => {
  const client = createAnonClient(mockEnv);

  it('returns correct url', () => {
    expect(client.url).toBe('https://test.supabase.co');
  });

  it('includes anon key as apikey header', () => {
    expect(client.headers.apikey).toBe('test-anon-key');
  });

  it('includes Authorization Bearer with anon key', () => {
    expect(client.headers.Authorization).toBe('Bearer test-anon-key');
  });

  it('does NOT include Prefer header', () => {
    expect(client.headers.Prefer).toBeUndefined();
  });

  it('has a fetch function', () => {
    expect(typeof client.fetch).toBe('function');
  });
});

describe('supabaseQuery', () => {
  function makeClient(mockFetch: jest.Mock): SupabaseClient {
    return {
      url: 'https://test.supabase.co',
      headers: {
        apikey: 'test-key',
        Authorization: 'Bearer test-key',
        'Content-Type': 'application/json',
      },
      fetch: mockFetch,
    };
  }

  function okResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('defaults to GET method', async () => {
    const mockFetch = jest.fn().mockResolvedValue(okResponse({ id: 1 }));
    const client = makeClient(mockFetch);

    await supabaseQuery(client, 'sites');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('constructs correct URL for GET request', async () => {
    const mockFetch = jest.fn().mockResolvedValue(okResponse([]));
    const client = makeClient(mockFetch);

    await supabaseQuery(client, 'sites');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://test.supabase.co/rest/v1/sites',
      expect.any(Object),
    );
  });

  it('appends query string when provided', async () => {
    const mockFetch = jest.fn().mockResolvedValue(okResponse([]));
    const client = makeClient(mockFetch);

    await supabaseQuery(client, 'sites', { query: 'slug=eq.my-site' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://test.supabase.co/rest/v1/sites?slug=eq.my-site',
      expect.any(Object),
    );
  });

  it('does not append query string when empty', async () => {
    const mockFetch = jest.fn().mockResolvedValue(okResponse([]));
    const client = makeClient(mockFetch);

    await supabaseQuery(client, 'sites', { query: '' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://test.supabase.co/rest/v1/sites',
      expect.any(Object),
    );
  });

  it('sends JSON body for POST request', async () => {
    const mockFetch = jest.fn().mockResolvedValue(okResponse({ id: 1 }));
    const client = makeClient(mockFetch);
    const body = { slug: 'my-site', name: 'My Site' };

    await supabaseQuery(client, 'sites', { method: 'POST', body });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );
  });

  it('sends body for PATCH request', async () => {
    const mockFetch = jest.fn().mockResolvedValue(okResponse({ id: 1 }));
    const client = makeClient(mockFetch);
    const body = { name: 'Updated Site' };

    await supabaseQuery(client, 'sites', { method: 'PATCH', body, query: 'id=eq.1' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://test.supabase.co/rest/v1/sites?id=eq.1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    );
  });

  it('sends DELETE request', async () => {
    const mockFetch = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = makeClient(mockFetch);

    const result = await supabaseQuery(client, 'sites', { method: 'DELETE', query: 'id=eq.1' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://test.supabase.co/rest/v1/sites?id=eq.1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(result.status).toBe(204);
  });

  it('adds Accept header when single=true', async () => {
    const mockFetch = jest.fn().mockResolvedValue(okResponse({ id: 1 }));
    const client = makeClient(mockFetch);

    await supabaseQuery(client, 'sites', { single: true });

    const calledHeaders = mockFetch.mock.calls[0][1].headers;
    expect(calledHeaders.Accept).toBe('application/vnd.pgrst.object+json');
  });

  it('returns parsed JSON data on success', async () => {
    const payload = [{ id: 1, slug: 'my-site' }];
    const mockFetch = jest.fn().mockResolvedValue(okResponse(payload));
    const client = makeClient(mockFetch);

    const result = await supabaseQuery(client, 'sites');

    expect(result.data).toEqual(payload);
    expect(result.error).toBeNull();
    expect(result.status).toBe(200);
  });

  it('returns error text on non-ok response', async () => {
    const errorBody = '{"message":"Row not found"}';
    const mockFetch = jest.fn().mockResolvedValue(
      new Response(errorBody, { status: 404, statusText: 'Not Found' }),
    );
    const client = makeClient(mockFetch);

    const result = await supabaseQuery(client, 'sites', { query: 'id=eq.999', single: true });

    expect(result.data).toBeNull();
    expect(result.error).toBe(errorBody);
    expect(result.status).toBe(404);
  });

  it('returns status 204 with null data', async () => {
    const mockFetch = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = makeClient(mockFetch);

    const result = await supabaseQuery(client, 'sites', { method: 'DELETE', query: 'id=eq.1' });

    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
    expect(result.status).toBe(204);
  });

  it('handles fetch exceptions gracefully', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('Network failure'));
    const client = makeClient(mockFetch);

    const result = await supabaseQuery(client, 'sites');

    expect(result.data).toBeNull();
    expect(result.error).toBe('Network failure');
    expect(result.status).toBe(500);
  });

  it('handles non-Error throw as unknown fetch error', async () => {
    const mockFetch = jest.fn().mockRejectedValue('string-error');
    const client = makeClient(mockFetch);

    const result = await supabaseQuery(client, 'sites');

    expect(result.data).toBeNull();
    expect(result.error).toBe('Unknown fetch error');
    expect(result.status).toBe(500);
  });
});
