import { atom } from 'nanostores';

export interface S3Connection {
  provider: 's3' | 'r2';
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  pathPrefix: string;
  customDomain: string;
  connected: boolean;
}

const STORAGE_KEY = 's3_connection';

const defaultState: S3Connection = {
  provider: 'r2',
  endpoint: '',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  region: 'auto',
  pathPrefix: '',
  customDomain: '',
  connected: false,
};

function loadFromStorage(): S3Connection {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (stored) {
      return { ...defaultState, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore parsing errors
  }

  return defaultState;
}

export const s3Connection = atom<S3Connection>(loadFromStorage());

export function updateS3Connection(update: Partial<S3Connection>): void {
  const current = s3Connection.get();
  const next = { ...current, ...update };
  s3Connection.set(next);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors
  }
}

export function disconnectS3(): void {
  s3Connection.set(defaultState);

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export async function testS3Connection(conn: S3Connection): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/s3-deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'test',
        provider: conn.provider,
        endpoint: conn.endpoint,
        bucket: conn.bucket,
        accessKeyId: conn.accessKeyId,
        secretAccessKey: conn.secretAccessKey,
        region: conn.region,
      }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };

    return data;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Connection failed' };
  }
}
