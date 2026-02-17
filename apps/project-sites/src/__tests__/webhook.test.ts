import { verifyStripeSignature, verifyHmacSignature } from '../services/webhook';
import { hmacSha256 } from '@project-sites/shared';

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test_secret_key_12345';

  async function makeSignedRequest(body: string, secret: string) {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = `${timestamp}.${body}`;
    const signature = await hmacSha256(secret, payload);
    return { signatureHeader: `t=${timestamp},v1=${signature}`, timestamp };
  }

  it('accepts valid signature', async () => {
    const body = '{"type":"test"}';
    const { signatureHeader } = await makeSignedRequest(body, secret);
    const result = await verifyStripeSignature(body, signatureHeader, secret);
    expect(result.valid).toBe(true);
  });

  it('rejects missing signature header', async () => {
    const result = await verifyStripeSignature('{}', '', secret);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing');
  });

  it('rejects missing secret', async () => {
    const result = await verifyStripeSignature('{}', 't=123,v1=abc', '');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing');
  });

  it('rejects invalid signature format', async () => {
    const result = await verifyStripeSignature('{}', 'invalid-format', secret);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Invalid signature format');
  });

  it('rejects expired timestamp', async () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
    const payload = `${oldTimestamp}.{}`;
    const signature = await hmacSha256(secret, payload);
    const result = await verifyStripeSignature(
      '{}',
      `t=${oldTimestamp},v1=${signature}`,
      secret,
      300,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Timestamp');
  });

  it('rejects wrong signature', async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const result = await verifyStripeSignature(
      '{}',
      `t=${timestamp},v1=deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678`,
      secret,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('mismatch');
  });

  it('rejects tampered body', async () => {
    const originalBody = '{"amount":100}';
    const { signatureHeader } = await makeSignedRequest(originalBody, secret);
    const tamperedBody = '{"amount":999}';
    const result = await verifyStripeSignature(tamperedBody, signatureHeader, secret);
    expect(result.valid).toBe(false);
  });

  it('rejects signature with wrong secret', async () => {
    const body = '{"test":true}';
    const { signatureHeader } = await makeSignedRequest(body, 'wrong-secret');
    const result = await verifyStripeSignature(body, signatureHeader, secret);
    expect(result.valid).toBe(false);
  });

  it('handles non-numeric timestamp', async () => {
    const result = await verifyStripeSignature('{}', 't=abc,v1=def', secret);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Timestamp');
  });

  it('accepts signature within tolerance window', async () => {
    const body = '{}';
    const timestamp = Math.floor(Date.now() / 1000) - 100; // 100 seconds ago
    const payload = `${timestamp}.${body}`;
    const signature = await hmacSha256(secret, payload);
    const result = await verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, secret, 300);
    expect(result.valid).toBe(true);
  });

  it('handles future timestamp within tolerance', async () => {
    const body = '{}';
    const timestamp = Math.floor(Date.now() / 1000) + 100; // 100 seconds in future
    const payload = `${timestamp}.${body}`;
    const signature = await hmacSha256(secret, payload);
    const result = await verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, secret, 300);
    expect(result.valid).toBe(true);
  });
});

describe('verifyHmacSignature', () => {
  const secret = 'test-hmac-secret-key';

  it('accepts valid signature', async () => {
    const body = '{"data":"test"}';
    const signature = await hmacSha256(secret, body);
    const result = await verifyHmacSignature(body, signature, secret);
    expect(result.valid).toBe(true);
  });

  it('rejects missing signature', async () => {
    const result = await verifyHmacSignature('{}', '', secret);
    expect(result.valid).toBe(false);
  });

  it('rejects missing secret', async () => {
    const result = await verifyHmacSignature('{}', 'sig', '');
    expect(result.valid).toBe(false);
  });

  it('rejects wrong signature', async () => {
    const result = await verifyHmacSignature('{}', 'wrong-sig', secret);
    expect(result.valid).toBe(false);
  });

  it('rejects tampered body', async () => {
    const signature = await hmacSha256(secret, '{"amount":100}');
    const result = await verifyHmacSignature('{"amount":999}', signature, secret);
    expect(result.valid).toBe(false);
  });
});
