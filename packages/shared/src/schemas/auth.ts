/**
 * Authentication schemas
 */
import { z } from 'zod';
import { uuidSchema, emailSchema, phoneSchema, isoDateTimeSchema, timestampsSchema } from './base.js';
import { AUTH } from '../constants/index.js';

// =============================================================================
// USER SCHEMA
// =============================================================================

export const userIdSchema = uuidSchema.describe('User ID');

export const userSchema = z
  .object({
    id: userIdSchema,
    email: emailSchema.nullable(),
    phone: phoneSchema.nullable(),
    email_verified: z.boolean().default(false),
    phone_verified: z.boolean().default(false),
    google_id: z.string().nullable(),
    avatar_url: z.string().url().nullable(),
    display_name: z.string().max(100).nullable(),
    last_login_at: isoDateTimeSchema.nullable(),
  })
  .merge(timestampsSchema);

export type User = z.infer<typeof userSchema>;

// =============================================================================
// SESSION SCHEMA
// =============================================================================

export const sessionSchema = z.object({
  id: uuidSchema,
  user_id: userIdSchema,
  token_hash: z.string(),
  ip_address: z.string().nullable(),
  user_agent: z.string().max(500).nullable(),
  device_info: z.string().max(200).nullable(),
  last_active_at: isoDateTimeSchema,
  expires_at: isoDateTimeSchema,
  created_at: isoDateTimeSchema,
  revoked_at: isoDateTimeSchema.nullable(),
});

export type Session = z.infer<typeof sessionSchema>;

export const sessionListItemSchema = z.object({
  id: uuidSchema,
  device_info: z.string().nullable(),
  ip_address: z.string().nullable(),
  last_active_at: isoDateTimeSchema,
  created_at: isoDateTimeSchema,
  is_current: z.boolean(),
});

export type SessionListItem = z.infer<typeof sessionListItemSchema>;

// =============================================================================
// MAGIC LINK SCHEMAS
// =============================================================================

export const magicLinkRequestSchema = z.object({
  email: emailSchema,
  redirect_url: z.string().url().optional(),
});

export type MagicLinkRequest = z.infer<typeof magicLinkRequestSchema>;

export const magicLinkSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  token_hash: z.string(),
  redirect_url: z.string().url().nullable(),
  expires_at: isoDateTimeSchema,
  used_at: isoDateTimeSchema.nullable(),
  created_at: isoDateTimeSchema,
});

export type MagicLink = z.infer<typeof magicLinkSchema>;

export const verifyMagicLinkSchema = z.object({
  token: z.string().min(32).max(128),
});

export type VerifyMagicLinkInput = z.infer<typeof verifyMagicLinkSchema>;

// =============================================================================
// OTP SCHEMAS
// =============================================================================

export const otpRequestSchema = z.object({
  phone: phoneSchema,
});

export type OtpRequest = z.infer<typeof otpRequestSchema>;

export const phoneOtpSchema = z.object({
  id: uuidSchema,
  phone: phoneSchema,
  otp_hash: z.string(),
  attempts: z.number().int().min(0).max(AUTH.OTP_MAX_ATTEMPTS),
  expires_at: isoDateTimeSchema,
  verified_at: isoDateTimeSchema.nullable(),
  created_at: isoDateTimeSchema,
});

export type PhoneOtp = z.infer<typeof phoneOtpSchema>;

export const verifyOtpSchema = z.object({
  phone: phoneSchema,
  otp: z.string().length(6).regex(/^\d{6}$/, 'OTP must be 6 digits'),
});

export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

// =============================================================================
// GOOGLE OAUTH SCHEMAS
// =============================================================================

export const oauthStateSchema = z.object({
  id: uuidSchema,
  state_token: z.string(),
  redirect_url: z.string().url().nullable(),
  code_verifier: z.string(), // For PKCE
  expires_at: isoDateTimeSchema,
  used_at: isoDateTimeSchema.nullable(),
  created_at: isoDateTimeSchema,
});

export type OAuthState = z.infer<typeof oauthStateSchema>;

export const googleOAuthCallbackSchema = z.object({
  code: z.string(),
  state: z.string(),
});

export type GoogleOAuthCallback = z.infer<typeof googleOAuthCallbackSchema>;

export const googleUserInfoSchema = z.object({
  sub: z.string(),
  email: z.string().email(),
  email_verified: z.boolean(),
  name: z.string().optional(),
  picture: z.string().url().optional(),
});

export type GoogleUserInfo = z.infer<typeof googleUserInfoSchema>;

// =============================================================================
// AUTH CONTEXT (for middleware)
// =============================================================================

export const authContextSchema = z.object({
  user_id: userIdSchema,
  session_id: uuidSchema,
  email: emailSchema.nullable(),
  phone: phoneSchema.nullable(),
  email_verified: z.boolean(),
  phone_verified: z.boolean(),
});

export type AuthContext = z.infer<typeof authContextSchema>;

// =============================================================================
// AUTH RESPONSES
// =============================================================================

export const authResponseSchema = z.object({
  user: userSchema.omit({ created_at: true, updated_at: true, deleted_at: true }),
  session: z.object({
    id: uuidSchema,
    expires_at: isoDateTimeSchema,
  }),
  needs_2fa: z.boolean(),
});

export type AuthResponse = z.infer<typeof authResponseSchema>;

export const twoFactorRequiredSchema = z.object({
  temp_token: z.string(),
  expires_at: isoDateTimeSchema,
  method: z.enum(['sms', 'totp']),
});

export type TwoFactorRequired = z.infer<typeof twoFactorRequiredSchema>;
