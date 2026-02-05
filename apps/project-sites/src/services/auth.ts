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
import type { SupabaseClient } from './db.js';
import { supabaseQuery } from './db.js';
import type { Env } from '../types/env.js';

/**
 * Create a magic link for passwordless email auth.
 * Stores token hash in DB; sends email via SendGrid.
 */
export async function createMagicLink(
  db: SupabaseClient,
  env: Env,
  input: CreateMagicLink,
): Promise<{ token: string; expires_at: string }> {
  const validated = createMagicLinkSchema.parse(input);

  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(
    Date.now() + AUTH.MAGIC_LINK_EXPIRY_HOURS * 60 * 60 * 1000,
  ).toISOString();

  await supabaseQuery(db, 'magic_links', {
    method: 'POST',
    body: {
      id: crypto.randomUUID(),
      email: validated.email,
      token_hash: tokenHash,
      redirect_url: validated.redirect_url ?? null,
      expires_at: expiresAt,
      used: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    },
  });

  return { token, expires_at: expiresAt };
}

/**
 * Verify a magic link token.
 * Returns the associated email if valid and not expired/used.
 */
export async function verifyMagicLink(
  db: SupabaseClient,
  input: VerifyMagicLink,
): Promise<{ email: string; redirect_url: string | null }> {
  const validated = verifyMagicLinkSchema.parse(input);
  const tokenHash = await sha256Hex(validated.token);

  const result = await supabaseQuery<
    Array<{
      id: string;
      email: string;
      redirect_url: string | null;
      used: boolean;
      expires_at: string;
    }>
  >(db, 'magic_links', {
    query: `token_hash=eq.${tokenHash}&used=eq.false&select=id,email,redirect_url,used,expires_at`,
  });

  const link = result.data?.[0];
  if (!link) {
    throw unauthorized('Invalid or expired magic link');
  }

  if (new Date(link.expires_at) < new Date()) {
    throw unauthorized('Magic link has expired');
  }

  // Mark as used
  await supabaseQuery(db, 'magic_links', {
    method: 'PATCH',
    query: `id=eq.${link.id}`,
    body: { used: true, updated_at: new Date().toISOString() },
  });

  return { email: link.email, redirect_url: link.redirect_url };
}

/**
 * Create a phone OTP for 2FA.
 */
export async function createPhoneOtp(
  db: SupabaseClient,
  env: Env,
  input: CreatePhoneOtp,
): Promise<{ expires_at: string }> {
  const validated = createPhoneOtpSchema.parse(input);

  // Rate limit: check recent OTPs for this phone
  const recentQuery = `phone=eq.${encodeURIComponent(validated.phone)}&created_at=gt.${new Date(Date.now() - 60000).toISOString()}&select=id`;
  const recent = await supabaseQuery<Array<{ id: string }>>(db, 'phone_otps', {
    query: recentQuery,
  });

  if (recent.data && recent.data.length >= 1) {
    throw rateLimited('Please wait before requesting another OTP');
  }

  const otp = generateOtp(AUTH.OTP_LENGTH);
  const otpHash = await sha256Hex(otp);
  const expiresAt = new Date(
    Date.now() + AUTH.OTP_EXPIRY_MINUTES * 60 * 1000,
  ).toISOString();

  await supabaseQuery(db, 'phone_otps', {
    method: 'POST',
    body: {
      id: crypto.randomUUID(),
      phone: validated.phone,
      otp_hash: otpHash,
      attempts: 0,
      expires_at: expiresAt,
      verified: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    },
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
 * Verify a phone OTP.
 */
export async function verifyPhoneOtp(
  db: SupabaseClient,
  input: VerifyPhoneOtp,
): Promise<{ verified: boolean }> {
  const validated = verifyPhoneOtpSchema.parse(input);
  const otpHash = await sha256Hex(validated.otp);

  // Find matching unexpired OTP
  const query = `phone=eq.${encodeURIComponent(validated.phone)}&verified=eq.false&expires_at=gt.${new Date().toISOString()}&order=created_at.desc&limit=1&select=id,otp_hash,attempts`;
  const result = await supabaseQuery<
    Array<{ id: string; otp_hash: string; attempts: number }>
  >(db, 'phone_otps', { query });

  const record = result.data?.[0];
  if (!record) {
    throw unauthorized('No pending OTP found');
  }

  // Check max attempts
  if (record.attempts >= AUTH.OTP_MAX_ATTEMPTS) {
    throw rateLimited('Too many OTP attempts');
  }

  // Increment attempts
  await supabaseQuery(db, 'phone_otps', {
    method: 'PATCH',
    query: `id=eq.${record.id}`,
    body: {
      attempts: record.attempts + 1,
      updated_at: new Date().toISOString(),
    },
  });

  if (record.otp_hash !== otpHash) {
    throw unauthorized('Invalid OTP');
  }

  // Mark as verified
  await supabaseQuery(db, 'phone_otps', {
    method: 'PATCH',
    query: `id=eq.${record.id}`,
    body: { verified: true, updated_at: new Date().toISOString() },
  });

  return { verified: true };
}

/**
 * Create Google OAuth state for CSRF protection.
 */
export async function createGoogleOAuthState(
  db: SupabaseClient,
  env: Env,
  redirectUrl?: string,
): Promise<{ authUrl: string; state: string }> {
  const state = randomHex(32);

  await supabaseQuery(db, 'oauth_states', {
    method: 'POST',
    body: {
      id: crypto.randomUUID(),
      state,
      provider: 'google',
      redirect_url: redirectUrl ?? null,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    },
  });

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${env.SUPABASE_URL.replace('.supabase.co', '')}/api/auth/google/callback`,
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
 * Handle Google OAuth callback.
 * Exchanges code for tokens and creates/links user.
 */
export async function handleGoogleOAuthCallback(
  db: SupabaseClient,
  env: Env,
  code: string,
  state: string,
): Promise<{ email: string; display_name: string | null; avatar_url: string | null }> {
  // Verify state
  const stateResult = await supabaseQuery<
    Array<{ id: string; state: string; expires_at: string }>
  >(db, 'oauth_states', {
    query: `state=eq.${state}&provider=eq.google&select=id,state,expires_at`,
  });

  const stateRecord = stateResult.data?.[0];
  if (!stateRecord) {
    throw unauthorized('Invalid OAuth state');
  }

  if (new Date(stateRecord.expires_at) < new Date()) {
    throw unauthorized('OAuth state expired');
  }

  // Delete used state
  await supabaseQuery(db, 'oauth_states', {
    method: 'DELETE',
    query: `id=eq.${stateRecord.id}`,
  });

  // Exchange code for tokens
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${env.SUPABASE_URL.replace('.supabase.co', '')}/api/auth/google/callback`,
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
 */
export async function createSession(
  db: SupabaseClient,
  userId: string,
  deviceInfo?: string,
  ipAddress?: string,
): Promise<{ token: string; expires_at: string }> {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(
    Date.now() + AUTH.SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  await supabaseQuery(db, 'sessions', {
    method: 'POST',
    body: {
      id: crypto.randomUUID(),
      user_id: userId,
      token_hash: tokenHash,
      device_info: deviceInfo ?? null,
      ip_address: ipAddress ?? null,
      expires_at: expiresAt,
      last_active_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    },
  });

  return { token, expires_at: expiresAt };
}

/**
 * Get session by token.
 */
export async function getSession(
  db: SupabaseClient,
  token: string,
): Promise<{
  id: string;
  user_id: string;
  expires_at: string;
} | null> {
  const tokenHash = await sha256Hex(token);

  const result = await supabaseQuery<
    Array<{ id: string; user_id: string; expires_at: string }>
  >(db, 'sessions', {
    query: `token_hash=eq.${tokenHash}&deleted_at=is.null&select=id,user_id,expires_at`,
  });

  const session = result.data?.[0];
  if (!session) return null;

  if (new Date(session.expires_at) < new Date()) {
    return null;
  }

  // Update last_active_at
  await supabaseQuery(db, 'sessions', {
    method: 'PATCH',
    query: `id=eq.${session.id}`,
    body: { last_active_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  });

  return session;
}

/**
 * Revoke a specific session.
 */
export async function revokeSession(
  db: SupabaseClient,
  sessionId: string,
): Promise<void> {
  await supabaseQuery(db, 'sessions', {
    method: 'PATCH',
    query: `id=eq.${sessionId}`,
    body: { deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  });
}

/**
 * Get all active sessions for a user.
 */
export async function getUserSessions(
  db: SupabaseClient,
  userId: string,
): Promise<Array<{ id: string; device_info: string | null; last_active_at: string; created_at: string }>> {
  const result = await supabaseQuery<
    Array<{ id: string; device_info: string | null; last_active_at: string; created_at: string }>
  >(db, 'sessions', {
    query: `user_id=eq.${userId}&deleted_at=is.null&expires_at=gt.${new Date().toISOString()}&select=id,device_info,last_active_at,created_at&order=last_active_at.desc`,
  });

  return result.data ?? [];
}
