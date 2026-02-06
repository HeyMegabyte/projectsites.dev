/**
 * @module auth
 * @description Passwordless authentication service for Project Sites.
 *
 * Supports three sign-in methods:
 *
 * | Method       | Flow                                        | Table          |
 * | ------------ | ------------------------------------------- | -------------- |
 * | Magic Link   | Email → click link → verify token hash      | `magic_links`  |
 * | Phone OTP    | SMS → enter 6-digit code → verify OTP hash  | `phone_otps`   |
 * | Google OAuth | Redirect → consent → exchange code → user   | `oauth_states` |
 *
 * Sessions are stored in the `sessions` table with SHA-256 hashed tokens.
 * All database access uses Cloudflare D1 via parameterized SQL.
 *
 * @example
 * ```ts
 * import * as authService from '../services/auth.js';
 *
 * // Magic link flow
 * const { token, expires_at } = await authService.createMagicLink(env.DB, env, { email });
 * const { email } = await authService.verifyMagicLink(env.DB, { token });
 *
 * // Phone OTP flow
 * await authService.createPhoneOtp(env.DB, env, { phone: '+15551234567' });
 * const { verified } = await authService.verifyPhoneOtp(env.DB, { phone, otp: '123456' });
 *
 * // Session management
 * const { token } = await authService.createSession(env.DB, userId);
 * const session = await authService.getSession(env.DB, token);
 * ```
 *
 * @packageDocumentation
 */

import {
  AUTH,
  randomHex,
  generateOtp,
  sha256Hex,
  type CreateMagicLink,
  type VerifyMagicLink,
  type CreatePhoneOtp,
  type VerifyPhoneOtp,
  createMagicLinkSchema,
  verifyMagicLinkSchema,
  createPhoneOtpSchema,
  verifyPhoneOtpSchema,
  unauthorized,
  badRequest,
  rateLimited,
} from '@project-sites/shared';
import { dbQuery, dbInsert, dbUpdate, dbExecute, dbQueryOne } from './db.js';
import type { Env } from '../types/env.js';

/**
 * Send a transactional email via the SendGrid v3 API.
 *
 * Gracefully skips if `SENDGRID_API_KEY` is not configured (logs a warning).
 *
 * @param env  - Worker environment (needs `SENDGRID_API_KEY`).
 * @param opts - Email parameters (to, subject, html body).
 *
 * @example
 * ```ts
 * await sendEmail(env, {
 *   to: 'user@example.com',
 *   subject: 'Sign in to Project Sites',
 *   html: '<h1>Click here</h1>',
 * });
 * ```
 */
async function sendEmail(
  env: Env,
  opts: { to: string; subject: string; html: string },
): Promise<void> {
  if (!env.SENDGRID_API_KEY) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'auth',
        message: 'SENDGRID_API_KEY not set, skipping email send',
        to: opts.to,
      }),
    );
    return;
  }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: opts.to }] }],
      from: { email: 'noreply@megabyte.space', name: 'Project Sites' },
      subject: opts.subject,
      content: [{ type: 'text/html', value: opts.html }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(
      JSON.stringify({
        level: 'error',
        service: 'auth',
        message: 'SendGrid API error',
        status: res.status,
        body: text.slice(0, 500),
      }),
    );
  }
}

/**
 * Build styled HTML for the magic-link email.
 *
 * @param verifyUrl - Full URL the user clicks to verify (includes token).
 * @returns Complete HTML document string.
 */
function buildMagicLinkEmail(verifyUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a1a;color:#e2e8f0;padding:40px 20px;">
  <div style="max-width:480px;margin:0 auto;background:#161635;border-radius:12px;padding:40px;border:1px solid rgba(100,255,218,0.1);">
    <h1 style="color:#64ffda;font-size:24px;margin:0 0 16px;">Sign in to Project Sites</h1>
    <p style="color:#94a3b8;line-height:1.6;margin:0 0 24px;">Click the button below to sign in. This link expires in ${AUTH.MAGIC_LINK_EXPIRY_HOURS} hour(s).</p>
    <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(135deg,#64ffda,#7c3aed);color:#0a0a1a;font-weight:700;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;">Sign In</a>
    <p style="color:#64748b;font-size:13px;margin:24px 0 0;">If you did not request this link, you can safely ignore this email.</p>
  </div>
</body>
</html>`.trim();
}

/**
 * Create a magic link for passwordless email authentication.
 *
 * Generates a random token, stores its SHA-256 hash in D1, and sends the
 * plaintext token to the user's email via SendGrid.
 *
 * @param db    - D1Database binding.
 * @param env   - Worker environment.
 * @param input - Must include `email`; optionally `redirect_url`.
 * @returns The plaintext token (for tests) and expiry timestamp.
 *
 * @example
 * ```ts
 * const { expires_at } = await createMagicLink(env.DB, env, {
 *   email: 'brian@megabyte.space',
 *   redirect_url: 'https://sites.megabyte.space/',
 * });
 * ```
 */
export async function createMagicLink(
  db: D1Database,
  env: Env,
  input: CreateMagicLink,
): Promise<{ token: string; expires_at: string }> {
  const validated = createMagicLinkSchema.parse(input);

  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(
    Date.now() + AUTH.MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000,
  ).toISOString();

  await dbInsert(db, 'magic_links', {
    id: crypto.randomUUID(),
    email: validated.email,
    token_hash: tokenHash,
    redirect_url: validated.redirect_url ?? null,
    expires_at: expiresAt,
    used: 0,
    deleted_at: null,
  });

  // Build verify URL and send email
  const baseUrl =
    env.ENVIRONMENT === 'production'
      ? 'https://sites.megabyte.space'
      : 'https://sites-staging.megabyte.space';
  const verifyUrl = `${baseUrl}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`;

  await sendEmail(env, {
    to: validated.email,
    subject: 'Sign in to Project Sites',
    html: buildMagicLinkEmail(verifyUrl),
  });

  return { token, expires_at: expiresAt };
}

/**
 * Verify a magic-link token.
 *
 * Hashes the incoming token, looks it up in D1, checks expiry, and marks
 * it as used. Returns the associated email and optional redirect URL.
 *
 * @param db    - D1Database binding.
 * @param input - Must include `token` (plaintext from email link).
 * @returns The email and redirect_url associated with the link.
 * @throws {unauthorized} If the token is invalid, expired, or already used.
 *
 * @example
 * ```ts
 * const { email, redirect_url } = await verifyMagicLink(env.DB, { token });
 * ```
 */
export async function verifyMagicLink(
  db: D1Database,
  input: VerifyMagicLink,
): Promise<{ email: string; redirect_url: string | null }> {
  const validated = verifyMagicLinkSchema.parse(input);
  const tokenHash = await sha256Hex(validated.token);

  const link = await dbQueryOne<{
    id: string;
    email: string;
    redirect_url: string | null;
    used: number;
    expires_at: string;
  }>(db, 'SELECT id, email, redirect_url, used, expires_at FROM magic_links WHERE token_hash = ? AND used = 0', [tokenHash]);

  if (!link) {
    throw unauthorized('Invalid or expired magic link');
  }

  if (new Date(link.expires_at) < new Date()) {
    throw unauthorized('Magic link has expired');
  }

  // Mark as used
  await dbUpdate(db, 'magic_links', { used: 1 }, 'id = ?', [link.id]);

  return { email: link.email, redirect_url: link.redirect_url };
}

/**
 * Create a phone OTP for two-factor authentication.
 *
 * Rate-limited to one OTP per phone number per 60 seconds.
 * In non-production environments, the OTP is logged to console for testing.
 *
 * @param db    - D1Database binding.
 * @param env   - Worker environment.
 * @param input - Must include `phone` in E.164 format (e.g. `+15551234567`).
 * @returns Expiry timestamp.
 * @throws {rateLimited} If another OTP was requested within the last 60 s.
 *
 * @example
 * ```ts
 * const { expires_at } = await createPhoneOtp(env.DB, env, { phone: '+15551234567' });
 * ```
 */
export async function createPhoneOtp(
  db: D1Database,
  env: Env,
  input: CreatePhoneOtp,
): Promise<{ expires_at: string }> {
  const validated = createPhoneOtpSchema.parse(input);

  // Rate limit: check recent OTPs for this phone
  const cutoff = new Date(Date.now() - 60000).toISOString();
  const { data: recent } = await dbQuery<{ id: string }>(
    db,
    'SELECT id FROM phone_otps WHERE phone = ? AND created_at > ?',
    [validated.phone, cutoff],
  );

  if (recent.length >= 1) {
    throw rateLimited('Please wait before requesting another OTP');
  }

  const otp = generateOtp(AUTH.OTP_LENGTH);
  const otpHash = await sha256Hex(otp);
  const expiresAt = new Date(Date.now() + AUTH.OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

  await dbInsert(db, 'phone_otps', {
    id: crypto.randomUUID(),
    phone: validated.phone,
    otp_hash: otpHash,
    attempts: 0,
    expires_at: expiresAt,
    verified: 0,
    deleted_at: null,
  });

  // In production: send OTP via SMS provider
  // For now, log for testing (OTP is NOT logged in production)
  if (env.ENVIRONMENT !== 'production') {
    console.warn(
      JSON.stringify({
        level: 'debug',
        service: 'auth',
        message: 'OTP generated (non-production only)',
        phone: validated.phone,
      }),
    );
  }

  return { expires_at: expiresAt };
}

/**
 * Verify a phone OTP code.
 *
 * Finds the most recent unexpired OTP for the phone number, increments the
 * attempt counter, and compares the SHA-256 hash. Locks out after
 * {@link AUTH.OTP_MAX_ATTEMPTS} failed attempts.
 *
 * @param db    - D1Database binding.
 * @param input - Must include `phone` and `otp` (6-digit string).
 * @returns `{ verified: true }` on success.
 * @throws {unauthorized} If no OTP is pending or the code is wrong.
 * @throws {rateLimited} If max attempts exceeded.
 *
 * @example
 * ```ts
 * const { verified } = await verifyPhoneOtp(env.DB, {
 *   phone: '+15551234567',
 *   otp: '483920',
 * });
 * ```
 */
export async function verifyPhoneOtp(
  db: D1Database,
  input: VerifyPhoneOtp,
): Promise<{ verified: boolean }> {
  const validated = verifyPhoneOtpSchema.parse(input);
  const otpHash = await sha256Hex(validated.otp);
  const now = new Date().toISOString();

  // Find matching unexpired OTP
  const record = await dbQueryOne<{ id: string; otp_hash: string; attempts: number }>(
    db,
    'SELECT id, otp_hash, attempts FROM phone_otps WHERE phone = ? AND verified = 0 AND expires_at > ? ORDER BY created_at DESC LIMIT 1',
    [validated.phone, now],
  );

  if (!record) {
    throw unauthorized('No pending OTP found');
  }

  // Check max attempts
  if (record.attempts >= AUTH.OTP_MAX_ATTEMPTS) {
    throw rateLimited('Too many OTP attempts');
  }

  // Increment attempts
  await dbUpdate(db, 'phone_otps', { attempts: record.attempts + 1 }, 'id = ?', [record.id]);

  if (record.otp_hash !== otpHash) {
    throw unauthorized('Invalid OTP');
  }

  // Mark as verified
  await dbUpdate(db, 'phone_otps', { verified: 1 }, 'id = ?', [record.id]);

  return { verified: true };
}

/**
 * Create a Google OAuth state token for CSRF protection.
 *
 * Generates a random state string, stores it in D1 with a 10-minute expiry,
 * and returns the full Google OAuth consent URL.
 *
 * @param db          - D1Database binding.
 * @param env         - Worker environment (needs `GOOGLE_CLIENT_ID`, `ENVIRONMENT`).
 * @param redirectUrl - Optional URL to redirect to after auth completes.
 * @returns The Google auth URL and the state token.
 *
 * @example
 * ```ts
 * const { authUrl, state } = await createGoogleOAuthState(env.DB, env);
 * return c.redirect(authUrl);
 * ```
 */
export async function createGoogleOAuthState(
  db: D1Database,
  env: Env,
  redirectUrl?: string,
): Promise<{ authUrl: string; state: string }> {
  const state = randomHex(32);

  await dbInsert(db, 'oauth_states', {
    id: crypto.randomUUID(),
    state,
    provider: 'google',
    redirect_url: redirectUrl ?? null,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
    deleted_at: null,
  });

  const callbackBase =
    env.ENVIRONMENT === 'production'
      ? 'https://sites.megabyte.space'
      : 'https://sites-staging.megabyte.space';

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${callbackBase}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });

  return {
    authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    state,
  };
}

/**
 * Handle the Google OAuth callback.
 *
 * Validates the state token, exchanges the authorization code for an access
 * token, fetches the user's profile, and returns their info.
 *
 * @param db    - D1Database binding.
 * @param env   - Worker environment.
 * @param code  - Authorization code from Google.
 * @param state - State token for CSRF validation.
 * @returns User profile (email, display_name, avatar_url).
 * @throws {unauthorized} If state is invalid or expired.
 * @throws {badRequest} If token exchange or profile fetch fails.
 *
 * @example
 * ```ts
 * const { email, display_name, avatar_url } =
 *   await handleGoogleOAuthCallback(env.DB, env, code, state);
 * ```
 */
export async function handleGoogleOAuthCallback(
  db: D1Database,
  env: Env,
  code: string,
  state: string,
): Promise<{ email: string; display_name: string | null; avatar_url: string | null }> {
  // Verify state
  const stateRecord = await dbQueryOne<{ id: string; state: string; expires_at: string }>(
    db,
    'SELECT id, state, expires_at FROM oauth_states WHERE state = ? AND provider = ?',
    [state, 'google'],
  );

  if (!stateRecord) {
    throw unauthorized('Invalid OAuth state');
  }

  if (new Date(stateRecord.expires_at) < new Date()) {
    throw unauthorized('OAuth state expired');
  }

  // Delete used state
  await dbExecute(db, 'DELETE FROM oauth_states WHERE id = ?', [stateRecord.id]);

  // Exchange code for tokens
  const callbackBase =
    env.ENVIRONMENT === 'production'
      ? 'https://sites.megabyte.space'
      : 'https://sites-staging.megabyte.space';

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${callbackBase}/api/auth/google/callback`,
    }),
  });

  if (!tokenResponse.ok) {
    throw badRequest('Failed to exchange OAuth code');
  }

  const tokens = (await tokenResponse.json()) as { access_token: string };

  // Get user info
  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userInfoResponse.ok) {
    throw badRequest('Failed to fetch Google user info');
  }

  const userInfo = (await userInfoResponse.json()) as {
    email: string;
    name?: string;
    picture?: string;
  };

  return {
    email: userInfo.email,
    display_name: userInfo.name ?? null,
    avatar_url: userInfo.picture ?? null,
  };
}

/**
 * Create a session for an authenticated user.
 *
 * Generates a random token, stores its SHA-256 hash in D1. The plaintext
 * token is returned to the client (typically as a cookie or Bearer header).
 *
 * @param db         - D1Database binding.
 * @param userId     - Authenticated user's ID.
 * @param deviceInfo - Optional device/browser fingerprint.
 * @param ipAddress  - Optional client IP address.
 * @returns Plaintext token and expiry.
 *
 * @example
 * ```ts
 * const { token, expires_at } = await createSession(env.DB, user.id);
 * c.header('Set-Cookie', `session=${token}; HttpOnly; Secure; Path=/`);
 * ```
 */
export async function createSession(
  db: D1Database,
  userId: string,
  deviceInfo?: string,
  ipAddress?: string,
): Promise<{ token: string; expires_at: string }> {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(
    Date.now() + AUTH.SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  await dbInsert(db, 'sessions', {
    id: crypto.randomUUID(),
    user_id: userId,
    token_hash: tokenHash,
    device_info: deviceInfo ?? null,
    ip_address: ipAddress ?? null,
    expires_at: expiresAt,
    last_active_at: new Date().toISOString(),
    deleted_at: null,
  });

  return { token, expires_at: expiresAt };
}

/**
 * Retrieve a session by its plaintext token.
 *
 * Hashes the token, looks it up, validates expiry, and bumps `last_active_at`.
 *
 * @param db    - D1Database binding.
 * @param token - Plaintext session token from the client.
 * @returns Session data or `null` if invalid/expired.
 *
 * @example
 * ```ts
 * const session = await getSession(env.DB, req.headers.get('Authorization'));
 * if (!session) return c.json({ error: 'Unauthorized' }, 401);
 * ```
 */
export async function getSession(
  db: D1Database,
  token: string,
): Promise<{
  id: string;
  user_id: string;
  expires_at: string;
} | null> {
  const tokenHash = await sha256Hex(token);

  const session = await dbQueryOne<{ id: string; user_id: string; expires_at: string }>(
    db,
    'SELECT id, user_id, expires_at FROM sessions WHERE token_hash = ? AND deleted_at IS NULL',
    [tokenHash],
  );

  if (!session) return null;

  if (new Date(session.expires_at) < new Date()) {
    return null;
  }

  // Update last_active_at
  await dbUpdate(db, 'sessions', { last_active_at: new Date().toISOString() }, 'id = ?', [session.id]);

  return session;
}

/**
 * Revoke (soft-delete) a session.
 *
 * @param db        - D1Database binding.
 * @param sessionId - The session ID to revoke.
 *
 * @example
 * ```ts
 * await revokeSession(env.DB, session.id);
 * ```
 */
export async function revokeSession(db: D1Database, sessionId: string): Promise<void> {
  await dbUpdate(db, 'sessions', { deleted_at: new Date().toISOString() }, 'id = ?', [sessionId]);
}

/**
 * List all active (non-expired, non-deleted) sessions for a user.
 *
 * @param db     - D1Database binding.
 * @param userId - The user whose sessions to retrieve.
 * @returns Array of session summaries sorted by most recent activity.
 *
 * @example
 * ```ts
 * const sessions = await getUserSessions(env.DB, userId);
 * // [{ id, device_info, last_active_at, created_at }, ...]
 * ```
 */
export async function getUserSessions(
  db: D1Database,
  userId: string,
): Promise<
  Array<{ id: string; device_info: string | null; last_active_at: string; created_at: string }>
> {
  const now = new Date().toISOString();
  const { data } = await dbQuery<{
    id: string;
    device_info: string | null;
    last_active_at: string;
    created_at: string;
  }>(
    db,
    'SELECT id, device_info, last_active_at, created_at FROM sessions WHERE user_id = ? AND deleted_at IS NULL AND expires_at > ? ORDER BY last_active_at DESC',
    [userId, now],
  );

  return data;
}
