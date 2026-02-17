/**
 * HTML and string sanitization utilities for user-provided and AI-generated content.
 *
 * This module provides defence-in-depth sanitizers that strip dangerous HTML
 * constructs (XSS vectors), remove all markup, and normalize slugs for use in
 * URLs and subdomain routing.
 *
 * | Export              | Description                                           |
 * | ------------------- | ----------------------------------------------------- |
 * | `sanitizeHtml`      | Strip `<script>`, event handlers, and protocol abuse  |
 * | `stripHtml`         | Remove **all** HTML tags, returning plain text        |
 * | `sanitizeSlug`      | Normalize a string into a URL-safe slug (max 63 chars)|
 * | `businessNameToSlug` | Convert a business name to a DNS-safe slug           |
 *
 * @example
 * ```ts
 * import { sanitizeHtml, stripHtml, sanitizeSlug, businessNameToSlug } from '@shared/utils/sanitize.js';
 *
 * const safe = sanitizeHtml('<p>Hello</p><script>alert(1)</script>');
 * // => '<p>Hello</p>'
 *
 * const plain = stripHtml('<b>Bold</b> text');
 * // => 'Bold text'
 *
 * const slug = businessNameToSlug("Joe's Bar & Grill");
 * // => 'joes-bar-and-grill'
 * ```
 *
 * @module sanitize
 * @packageDocumentation
 */

/**
 * Sanitize an HTML string by removing known XSS vectors.
 *
 * The following dangerous patterns are stripped:
 * - `<script>` blocks (including nested content)
 * - Inline event-handler attributes (`onclick`, `onerror`, etc.)
 * - `javascript:`, `data:`, and `vbscript:` URI schemes
 * - `<iframe>`, `<object>`, and `<embed>` elements
 *
 * **Note:** This is a regex-based sanitizer intended as a defence-in-depth
 * layer. It should be combined with a CSP and, where possible, a DOM-based
 * sanitizer on the client.
 *
 * @param input - The raw HTML string to sanitize.
 * @returns The input with dangerous constructs removed. Safe markup is preserved.
 *
 * @example
 * ```ts
 * sanitizeHtml('<div onclick="steal()">Hi</div>');
 * // => '<div>Hi</div>'
 * ```
 */
export function sanitizeHtml(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/data\s*:/gi, '')
    .replace(/vbscript\s*:/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '');
}

/**
 * Strip **all** HTML tags from a string, returning plain text.
 *
 * Uses a single-pass regex to remove every `<...>` construct. This is useful
 * when you need a text-only representation for indexing, logging, or
 * notification previews.
 *
 * @param input - A string that may contain HTML tags.
 * @returns The input with every HTML tag removed.
 *
 * @example
 * ```ts
 * stripHtml('<h1>Title</h1><p>Body</p>');
 * // => 'TitleBody'
 * ```
 */
export function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, '');
}

/**
 * Normalize an arbitrary string into a URL- and DNS-safe slug.
 *
 * Processing steps:
 * 1. Convert to lowercase.
 * 2. Trim leading/trailing whitespace.
 * 3. Replace non-alphanumeric characters (except hyphens) with `-`.
 * 4. Collapse consecutive hyphens into one.
 * 5. Remove leading and trailing hyphens.
 * 6. Truncate to 63 characters (the maximum DNS label length).
 *
 * @param input - The raw string to convert into a slug.
 * @returns A lowercase, hyphen-separated slug of at most 63 characters.
 *
 * @example
 * ```ts
 * sanitizeSlug('  My Cool Site!! ');
 * // => 'my-cool-site'
 * ```
 */
export function sanitizeSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 63);
}

/**
 * Convert a business name into a DNS-safe slug suitable for subdomain routing.
 *
 * Before delegating to {@link sanitizeSlug}, this function:
 * - Removes apostrophes and common quote variants (`'`, `\u2018`, `\u2019`,
 *   `` ` ``, `\u00B4`).
 * - Replaces ampersands (`&`) with the word `and`.
 *
 * The resulting slug is used for `{slug}-sites.megabyte.space` subdomain
 * routing in the Project Sites worker.
 *
 * @param name - The business name as returned by Google Places or entered by
 *   the user.
 * @returns A lowercase, hyphen-separated slug of at most 63 characters.
 *
 * @example
 * ```ts
 * businessNameToSlug("Ben & Jerry's");
 * // => 'ben-and-jerrys'
 * ```
 */
export function businessNameToSlug(name: string): string {
  return sanitizeSlug(name.replace(/['\u2018\u2019\u0060\u00B4]/g, '').replace(/&/g, 'and'));
}
