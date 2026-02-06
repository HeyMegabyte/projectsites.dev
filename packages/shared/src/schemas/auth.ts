import { z } from 'zod';
import { baseFields, emailSchema, phoneSchema, uuidSchema } from './base.js';

/** User schema */
export const userSchema = z.object({
  id: baseFields.id,
  email: emailSchema.nullable(),
  phone: phoneSchema.nullable(),
  display_name: z.string().max(200).nullable(),
  avatar_url: z.string().url().max(2048).nullable(),
  created_at: baseFields.created_at,
  updated_at: baseFields.updated_at,
  deleted_at: baseFields.deleted_at,
});

/** Session schema */
export const sessionSchema = z.object({
  id: baseFields.id,
  user_id: uuidSchema,
  token_hash: z.string().max(128),
  device_info: z.string().max(500).nullable(),
  ip_address: z.string().max(45).nullable(),
  expires_at: z.string().datetime(),
  last_active_at: z.string().datetime(),
  created_at: baseFields.created_at,
  updated_at: baseFields.updated_at,
  deleted_at: baseFields.deleted_at,
});

/** Magic link request */
export const createMagicLinkSchema = z.object({
  email: emailSchema,
  redirect_url: z.string().url().max(2048).optional(),
  turnstile_token: z.string().max(2048).optional(),
});

/** Verify magic link */
export const verifyMagicLinkSchema = z.object({
  token: z.string().min(32).max(512),
});

/** Create phone OTP request */
export const createPhoneOtpSchema = z.object({
  phone: phoneSchema,
  turnstile_token: z.string().max(2048).optional(),
});

/** Verify phone OTP */
export const verifyPhoneOtpSchema = z.object({
  phone: phoneSchema,
  otp: z
    .string()
    .length(6)
    .regex(/^\d{6}$/, 'OTP must be 6 digits'),
});

/** Google OAuth initiation */
export const createGoogleOAuthSchema = z.object({
  redirect_url: z.string().url().max(2048).optional(),
});

/** Google OAuth callback */
export const googleOAuthCallbackSchema = z.object({
  code: z.string().min(1).max(4096),
  state: z.string().min(1).max(4096),
});

/** Login response */
export const loginResponseSchema = z.object({
  user: userSchema,
  session: z.object({
    token: z.string(),
    expires_at: z.string().datetime(),
  }),
  requires_2fa: z.boolean(),
});

export type User = z.infer<typeof userSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type CreateMagicLink = z.infer<typeof createMagicLinkSchema>;
export type VerifyMagicLink = z.infer<typeof verifyMagicLinkSchema>;
export type CreatePhoneOtp = z.infer<typeof createPhoneOtpSchema>;
export type VerifyPhoneOtp = z.infer<typeof verifyPhoneOtpSchema>;
export type GoogleOAuthCallback = z.infer<typeof googleOAuthCallbackSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
