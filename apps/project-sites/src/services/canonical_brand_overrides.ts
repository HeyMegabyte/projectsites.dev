/**
 * @module services/canonical_brand_overrides
 * @description Hardcoded brand-contract overrides for sites where the LLM
 * brand-research pass has regressed against a previously-blessed reference
 * build. Sourced from the actual `_brand.json` payload in R2 at the time of
 * the blessed build — see `scripts/lmg-canonical-brand.json` for the
 * documentation copy.
 *
 * When a slug matches an entry here, the workflow's `extract-source-brand`
 * step uses this payload verbatim and SKIPS the LLM brand pass entirely.
 * This is the build-breaking ground truth — orchestrator + validator
 * compare every rendered font/theme/primary against it.
 *
 * Background: 2026-05-08 LMG `2026-05-08T01-01-59-742Z` build (249 files)
 * was visually superior to every subsequent rebuild because Poppins+Hind
 * + light theme + `#1dc2c9` primary were extracted cleanly. The 2026-05-09
 * regression flipped fonts and dimmed the primary. See memory pin
 * `feedback_brand_fidelity_regression.md`.
 *
 * @see {@link CanonicalBrand} for the override schema.
 * @see {@link getCanonicalBrand} for the lookup API.
 * @see {@link applyCanonicalBrandOverride} for the merge semantics.
 */

import type { SourceBrand } from './source_brand_extractor.js';

/**
 * Subset of {@link SourceBrand} that can be hardcoded as a build-breaking
 * contract for a specific slug. Anything outside this shape (assets[],
 * routes[], html_excerpt) is still discovered live by the extractor.
 */
export interface CanonicalBrand {
  /** Lowercase slug match — exact equality required. */
  slug: string;
  /** Origin build identifier — `2026-05-08T01-01-59-742Z` style. */
  source_build: string;
  /** Source homepage URL that produced this contract. */
  source_url: string;
  /** Hex primary brand color — drives template selection. */
  primary: string;
  /** Hex secondary brand color. */
  secondary: string;
  /** Hex accent — used for buttons/links/hover states. */
  accent: string;
  /** Theme polarity — `light` or `dark`. */
  theme: 'light' | 'dark';
  /** True when source aesthetic ≥ 7/10 — orchestrator mirrors layout. */
  preserve_source_design: boolean;
  /** True when the hero image is derived from the logo (e.g. mountain silhouette). */
  hero_extracted_from_logo: boolean;
  /** Font families — anchors the build-breaking typography gate. */
  fonts: {
    /** Logo wordmark font (e.g. `Poppins`). */
    logo: string;
    /** Heading font (h1-h3). Often matches `logo`. */
    heading: string;
    /** Body font (paragraphs, list items, captions). */
    body: string;
  };
  /** Logo URLs from the source domain. Wordmark + icon-only. */
  logo: {
    /** Header/footer wordmark with text. */
    original_url: string;
    /** Square icon-only — feeds favicon pipeline. */
    original_icon_url: string;
  };
  /** Confidence 0-1 for the contract overall. */
  confidence: number;
  /** Human-readable comment for ops review. */
  reason: string;
}

/**
 * Slug → contract registry. Add entries here when a build regresses below
 * its prior blessed quality and the LLM brand pass keeps drifting. Each
 * entry corresponds to one `scripts/<slug>-canonical-brand.json` doc.
 */
const REGISTRY: Record<string, CanonicalBrand> = {
  lonemountainglobal: {
    slug: 'lonemountainglobal',
    source_build: '2026-05-08T01-01-59-742Z',
    source_url: 'https://lonemountainglobal.com',
    primary: '#1dc2c9',
    secondary: '#daecee',
    accent: '#0a8f95',
    theme: 'light',
    preserve_source_design: true,
    hero_extracted_from_logo: true,
    fonts: {
      logo: 'Poppins',
      heading: 'Poppins',
      body: 'Hind',
    },
    logo: {
      original_url:
        'https://lonemountainglobal.com/wp-content/uploads/2024/03/logo-text-color.png',
      original_icon_url:
        'https://lonemountainglobal.com/wp-content/uploads/2024/03/logo-icon-512x512-1.png',
    },
    confidence: 0.97,
    reason:
      'Sourced from the 249-file blessed build at R2 path sites/lonemountainglobal/2026-05-08T01-01-59-742Z/_src/.ssr/_brand.json. Subsequent LLM passes regressed Poppins→Inter and primary hue.',
  },
};

/**
 * Look up a hardcoded contract by slug. Returns `null` when the slug has
 * no canonical override registered (most sites).
 *
 * @param slug - Site slug, e.g. `lonemountainglobal`.
 * @returns The contract entry, or `null`.
 *
 * @example
 * ```ts
 * const contract = getCanonicalBrand('lonemountainglobal');
 * if (contract) {
 *   // skip LLM brand pass, use contract verbatim
 * }
 * ```
 */
export function getCanonicalBrand(slug: string): CanonicalBrand | null {
  return REGISTRY[slug.toLowerCase()] ?? null;
}

/**
 * Whether a given slug has a hardcoded brand contract registered. Cheap
 * boolean predicate for hot paths.
 */
export function hasCanonicalBrand(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, slug.toLowerCase());
}

/**
 * Build a synthetic {@link SourceBrand} from a {@link CanonicalBrand} entry,
 * used to short-circuit the LLM brand pass entirely. The resulting payload
 * is structurally identical to what {@link extractSourceBrand} would return,
 * so the rest of the pipeline (persist → orchestrator → validator) works
 * unchanged.
 *
 * The synthetic record always carries `fonts.source = 'extracted'` and
 * `warnings = ['canonical_override_applied']` so downstream consumers can
 * tell the contract is hardcoded.
 *
 * @param contract - Canonical contract returned from {@link getCanonicalBrand}.
 * @returns A fully populated {@link SourceBrand} ready for persistence.
 */
export function canonicalBrandToSourceBrand(contract: CanonicalBrand): SourceBrand {
  return {
    source_url: contract.source_url,
    fetched_at: new Date().toISOString(),
    theme: contract.theme,
    preserve_source_design: contract.preserve_source_design,
    cms: 'wordpress',
    fonts: {
      logo: contract.fonts.logo,
      heading: contract.fonts.heading,
      body: contract.fonts.body,
      source: 'extracted',
      observed: [contract.fonts.logo, contract.fonts.heading, contract.fonts.body],
      google_fonts: Array.from(
        new Set([contract.fonts.logo, contract.fonts.heading, contract.fonts.body]),
      ),
    },
    logo: {
      original_url: contract.logo.original_url,
      original_icon_url: contract.logo.original_icon_url,
      source: { wordmark: 'canonical_override', icon: 'canonical_override' },
    },
    colors: {
      ranked: [
        { hex: contract.primary, count: 1 },
        { hex: contract.secondary, count: 1 },
        { hex: contract.accent, count: 1 },
      ],
      primary: contract.primary,
      secondary: contract.secondary,
      background: contract.theme === 'light' ? '#ffffff' : '#0a0a1a',
    },
    assets: [],
    routes: [],
    html_excerpt: '',
    warnings: ['canonical_override_applied'],
  };
}

/**
 * Merge a canonical contract into an already-extracted {@link SourceBrand},
 * overriding only the fields the contract pins (fonts, colors, theme,
 * preserve_source_design, hero_extracted_from_logo, logo URLs). Keeps the
 * live assets[]/routes[]/html_excerpt from the real extraction so the
 * orchestrator still sees the source media + URL graph.
 *
 * This is the recommended path when the contract is registered AND the
 * source site is reachable. When the source is down, fall back to
 * {@link canonicalBrandToSourceBrand} for a fully synthetic payload.
 *
 * @param contract - Canonical override.
 * @param extracted - Live extractor output to layer the contract on top of.
 * @returns Merged brand record — same shape as {@link SourceBrand}.
 */
export function applyCanonicalBrandOverride(
  contract: CanonicalBrand,
  extracted: SourceBrand,
): SourceBrand {
  return {
    ...extracted,
    theme: contract.theme,
    preserve_source_design: contract.preserve_source_design,
    fonts: {
      ...extracted.fonts,
      logo: contract.fonts.logo,
      heading: contract.fonts.heading,
      body: contract.fonts.body,
      source: 'extracted',
      google_fonts: Array.from(
        new Set([
          contract.fonts.logo,
          contract.fonts.heading,
          contract.fonts.body,
          ...extracted.fonts.google_fonts,
        ]),
      ),
    },
    logo: {
      original_url: contract.logo.original_url || extracted.logo.original_url,
      original_icon_url: contract.logo.original_icon_url || extracted.logo.original_icon_url,
      source: {
        wordmark: contract.logo.original_url
          ? 'canonical_override'
          : extracted.logo.source.wordmark,
        icon: contract.logo.original_icon_url
          ? 'canonical_override'
          : extracted.logo.source.icon,
      },
    },
    colors: {
      ...extracted.colors,
      primary: contract.primary,
      secondary: contract.secondary,
    },
    warnings: [...extracted.warnings, 'canonical_override_applied'],
  };
}
