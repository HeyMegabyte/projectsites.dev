#!/usr/bin/env node
/**
 * Local build agent — runs on your Mac, receives build jobs from the Worker.
 * Uses Claude Code CLI for $100K quality website generation.
 *
 * Optimized 2-phase approach:
 * Phase 1 (deterministic): Clone template, npm install, write context files
 * Phase 2 (Claude Code): ONE focused call to customize every file
 *
 * Usage: node local-agent.mjs
 * The Worker sends build jobs to http://localhost:4400/build
 */
import http from 'node:http';
import { execSync, exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { collectAssets } from './asset-collector.mjs';

const PORT = 4400;
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const TEMPLATE_REPO = 'https://github.com/HeyMegabyte/template.projectsites.dev.git';

/** Strip tracking params (utm_*, fbclid, gclid, etc.) from URLs for a clean appearance. */
function cleanUrl(raw) {
  if (!raw?.trim()) return '';
  try {
    let s = raw.trim();
    if (!s.startsWith('http://') && !s.startsWith('https://')) s = 'https://' + s;
    const u = new URL(s);
    const junk = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid','gad_source','dclid','msclkid','ref','source','si','_ga','_gl'];
    for (const p of junk) u.searchParams.delete(p);
    let c = u.origin + u.pathname;
    if (u.searchParams.toString()) c += '?' + u.searchParams.toString();
    if (c.endsWith('/') && c !== u.origin + '/') c = c.slice(0, -1);
    return c;
  } catch { return raw.trim().replace(/[?&](utm_\w+|fbclid|gclid|ref|source)=[^&#]*/gi, '').replace(/\?$/, ''); }
}

// Load env
// Try multiple paths for .env.local (worktree layout varies)
const envCandidates = [
  path.join(import.meta.dirname, '../../../.env.local'),   // container → project-sites → apps → root
  path.join(import.meta.dirname, '../../.env.local'),      // fallback
  '/Users/apple/emdash-projects/worktrees/rare-chefs-film-8op/.env.local', // absolute fallback
];
const envPath = envCandidates.find(p => fs.existsSync(p)) || envCandidates[0];
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const [key, ...val] = line.split('=');
    if (key && !key.startsWith('#')) process.env[key.trim()] = val.join('=').trim();
  }
}

const R2_BUCKET = 'project-sites-production';
const WRANGLER_CWD = '/Users/apple/emdash-projects/worktrees/rare-chefs-film-8op/apps/project-sites';

async function r2Put(key, content, contentType = 'text/html') {
  const tmpFile = `/tmp/r2-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmpFile, content);
  try {
    execSync(
      `npx wrangler r2 object put "${R2_BUCKET}/${key}" --file "${tmpFile}" --content-type "${contentType}" --remote`,
      { stdio: 'pipe', timeout: 60000, cwd: WRANGLER_CWD, env: { ...process.env } }
    );
    return true;
  } catch (err) {
    console.warn(`  R2 failed: ${key}`);
    return false;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

async function r2PutBinary(key, filePath, contentType) {
  try {
    execSync(
      `npx wrangler r2 object put "${R2_BUCKET}/${key}" --file "${filePath}" --content-type "${contentType}" --remote`,
      { stdio: 'pipe', timeout: 60000, cwd: WRANGLER_CWD, env: { ...process.env } }
    );
    return true;
  } catch (err) {
    console.warn(`  R2 binary failed: ${key}`);
    return false;
  }
}

async function d1Query(sql, params = []) {
  try {
    let finalSql = sql;
    for (const p of params) {
      finalSql = finalSql.replace('?', `'${String(p).replace(/'/g, "''")}'`);
    }
    execSync(
      `npx wrangler d1 execute project-sites-db-production --env production --remote --command "${finalSql.replace(/"/g, '\\"')}"`,
      { stdio: 'pipe', timeout: 30000, cwd: WRANGLER_CWD, env: { ...process.env } }
    );
    return { success: true };
  } catch (err) {
    console.warn(`  D1 error: ${err.stderr?.toString()?.substring(0, 150) || err.message?.substring(0, 150)}`);
    return { success: false };
  }
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT FILE GENERATORS
// ═══════════════════════════════════════════════════════════════

function generateContextMd(params) {
  const { businessName, slug, researchData, assetUrls, additionalContext } = params;
  const profile = researchData?.profile || {};
  const brand = researchData?.brand || {};
  const selling = researchData?.sellingPoints || {};
  const social = researchData?.social || {};
  const images = researchData?.images || {};

  const sections = [];

  // Business identity
  sections.push(`# ${businessName}\n`);
  if (profile.description) sections.push(`> ${profile.description}\n`);

  sections.push(`## Identity`);
  sections.push(`- **Type**: ${profile.business_type || 'Business'}`);
  if (profile.established_year) sections.push(`- **Established**: ${profile.established_year}`);
  if (profile.address) sections.push(`- **Address**: ${typeof profile.address === 'string' ? profile.address : JSON.stringify(profile.address)}`);
  if (profile.phone) sections.push(`- **Phone**: ${profile.phone}`);
  if (profile.email) sections.push(`- **Email**: ${profile.email}`);
  if (social.website_url) sections.push(`- **Website**: ${cleanUrl(social.website_url)}`);
  sections.push('');

  // Brand
  sections.push(`## Brand`);
  sections.push(`- **Primary Color**: ${brand.primary_color || '#1a365d'}`);
  sections.push(`- **Secondary Color**: ${brand.secondary_color || '#2d3748'}`);
  sections.push(`- **Accent Color**: ${brand.accent_color || '#e53e3e'}`);
  sections.push(`- **Heading Font**: ${brand.heading_font || 'Merriweather'}`);
  sections.push(`- **Body Font**: ${brand.body_font || 'Source Sans Pro'}`);
  if (brand.style_notes) sections.push(`- **Style**: ${brand.style_notes}`);
  sections.push('');

  // Services
  if (profile.services?.length) {
    sections.push(`## Services`);
    for (const s of profile.services) {
      if (typeof s === 'string') {
        sections.push(`- ${s}`);
      } else {
        sections.push(`### ${s.name || s.title || 'Service'}`);
        if (s.description) sections.push(s.description);
        if (s.price) sections.push(`**Price**: ${s.price}`);
        sections.push('');
      }
    }
    sections.push('');
  }

  // Hours
  if (profile.hours?.length) {
    sections.push(`## Hours`);
    for (const h of profile.hours) {
      sections.push(`- **${h.day}**: ${h.open || 'Closed'} – ${h.close || 'Closed'}`);
    }
    sections.push('');
  }

  // Selling points
  if (selling.selling_points?.length) {
    sections.push(`## Selling Points (use as feature cards)`);
    for (const sp of selling.selling_points) {
      sections.push(`### ${sp.headline || sp.title || 'Feature'}`);
      sections.push(sp.description || sp.body || '');
      sections.push('');
    }
  }

  // Hero slogans
  if (selling.hero_slogans?.length) {
    sections.push(`## Hero Slogans (pick the best for the hero section)`);
    for (const h of selling.hero_slogans) {
      const slogan = typeof h === 'string' ? h : h.primary || h.text || JSON.stringify(h);
      sections.push(`- "${slogan}"`);
    }
    sections.push('');
  }

  // Social links
  if (social.social_links?.length) {
    sections.push(`## Social Media`);
    for (const link of social.social_links) {
      sections.push(`- **${link.platform}**: ${link.url}`);
    }
    sections.push('');
  }

  // Asset manifest images (collected from 14 APIs)
  const manifest = params.assetManifest || {};
  if (manifest.images?.length) {
    sections.push(`## Available Images in assets/ folder — USE ALL OF THEM`);
    sections.push(`There are ${manifest.images.length} real images in the assets/ folder. You MUST use every single one.`);
    sections.push(`Import in React: \`const img = new URL('../assets/filename.jpg', import.meta.url).href\``);
    sections.push('');
    for (const img of manifest.images) {
      const imgPath = img.path || img.name || 'unknown';
      const imgName = img.name || (imgPath ? imgPath.split('/').pop() : 'image');
      sections.push(`- **${imgPath}** — ${img.source || 'stock'} — ${imgName}`);
    }
    sections.push('');
    sections.push(`### Suggested placement:`);
    sections.push(`- Hero background: use the first "ai-hero" or "stock-1" image with a gradient overlay`);
    sections.push(`- About section: use "streetview", "places-*", or "ai-about" images`);
    sections.push(`- Gallery/carousel: use ALL stock and places images in a swipeable gallery`);
    sections.push(`- Service cards: use relevant stock images as card backgrounds`);
    sections.push(`- Map: use "map-dark.png" on the contact page instead of an iframe`);
    const logoPath = typeof manifest.logo === 'string' ? manifest.logo : manifest.logo?.path || manifest.logo?.file || '';
    if (logoPath) sections.push(`- Logo: use "${logoPath}" in the nav bar`);
    sections.push('');
  }

  // Legacy asset URLs (from form)
  if (assetUrls?.length) {
    sections.push(`## User-Uploaded Images (from /create form)`);
    for (const a of assetUrls) {
      sections.push(`- \`${a.url || a}\` — ${a.name || 'image'}`);
    }
    sections.push('');
  }

  // Reviews & ratings
  const gRating = manifest.placesRating || null;
  const yRating = manifest.yelpRating || null;
  const bestRating = gRating || yRating;
  const totalReviews = (manifest.placesReviewCount || 0) + (manifest.yelpReviewCount || 0);
  if (bestRating) {
    sections.push(`## Reviews & Ratings`);
    if (gRating) sections.push(`- **Google Rating**: ${gRating}/5 (${manifest.placesReviewCount || 0} reviews)`);
    if (yRating) sections.push(`- **Yelp Rating**: ${yRating}/5 (${manifest.yelpReviewCount || 0} reviews)`);
    sections.push(`- **Use in JSON-LD**: aggregateRating with ratingValue=${bestRating}, reviewCount=${totalReviews}`);
    sections.push(`- **Display**: Show ${bestRating}/5 stars with filled/empty star SVGs prominently on the homepage`);
    sections.push('');
  }

  if (manifest.reviews?.length) {
    sections.push(`## Real Customer Reviews (use as testimonials)`);
    for (const r of manifest.reviews) {
      sections.push(`> "${r.text}" — **${r.author}** (${r.rating}/5 stars, ${r.source})`);
      sections.push('');
    }
  }

  // Map
  const mapPath = typeof manifest.mapImage === 'string' ? manifest.mapImage : manifest.mapImage?.path || manifest.mapImage?.file || '';
  if (mapPath) {
    sections.push(`## Map Image`);
    sections.push(`A dark-styled Mapbox map is available at: ${mapPath}`);
    sections.push(`Use this as an <img> on the contact page instead of a Google Maps iframe.`);
    sections.push('');
  }

  // Additional context
  if (additionalContext) {
    sections.push(`## Additional Context`);
    sections.push(additionalContext);
    sections.push('');
  }

  // Contact form
  sections.push(`## Contact Form`);
  sections.push(`POST to: https://projectsites.dev/api/contact-form/${slug}`);
  sections.push(`Fields: name, email, phone, message`);
  sections.push('');

  // Canonical URL
  sections.push(`## URLs`);
  sections.push(`- Site: https://${slug}.projectsites.dev`);
  sections.push(`- Contact form action: https://projectsites.dev/api/contact-form/${slug}`);

  return sections.join('\n');
}

function getIndustryContext(category) {
  const industries = {
    'Restaurant / Café': {
      extraPages: ['Menu'],
      sections: [
        'FULL MENU with every category and every item: appetizers, mains, sides, desserts, drinks, cocktails. Each item MUST have name + description + price. If menu data is in research or scraped content, use the COMPLETE menu — do not abbreviate. Use WebSearch to find the full menu if not provided.',
        'Associate menu items with relevant food images from assets/ where possible',
        'Chef/Kitchen Team spotlight with bio',
        'Ambiance section with warm gradient backgrounds',
        'Reservations CTA with prominent phone number and hours',
        'Hours displayed prominently on homepage and contact page',
      ],
      designNotes: 'Warm palette: rich browns, golds, deep reds, cream. Serif headings (Playfair Display). Moody/elegant feel for fine dining, bright/fresh for cafés.',
      reference: 'noma, eleven-madison-park',
    },
    'Salon / Barbershop': {
      extraPages: ['Services & Pricing'],
      sections: ['Service list with name, duration, price grouped by category', 'Stylists grid with specialty', 'Before/After concept cards', 'Booking CTA', 'Products showcase'],
      designNotes: 'Sleek premium: dark backgrounds, gold/copper accents. Serif headings. Monochrome + one accent. Instagram-style portfolio grid.',
      reference: 'blindbarber, fellowbarber',
    },
    'Legal / Law Firm': {
      extraPages: ['Practice Areas'],
      sections: ['Practice area grid with icons', 'Attorney profiles with education and bar admissions', 'Notable case results', 'Free consultation CTA', 'Resources/Insights preview'],
      designNotes: 'Professional: navy, charcoal, gold. Traditional serif (Merriweather). Conservative layout, generous whitespace. Subtle transitions only.',
      reference: 'cravath, skadden',
    },
    'Medical / Healthcare': {
      extraPages: ['Specialties'],
      sections: ['Medical services grid', 'Provider profiles with credentials', 'Patient resources (insurance, forms)', 'Appointment booking CTA', 'HIPAA compliance notice'],
      designNotes: 'Clean calming: light blues, whites, soft greens. Modern sans-serif (Poppins). WCAG AA accessibility. Trust signals prominent.',
      reference: 'mayoclinic, clevelandclinic',
    },
    'Technology / SaaS': {
      extraPages: ['Features', 'Pricing'],
      sections: ['Bento grid features', 'How It Works 3-step process', 'Pricing tiers (Free/Pro/Enterprise)', 'Integrations grid', 'Developer resources'],
      designNotes: 'Futuristic minimal: dark (#0a0a0a), neon accents. Space Grotesk/Inter. Glassmorphism, gradient borders, glow effects. Terminal aesthetic.',
      reference: 'vercel, linear',
    },
    'Fitness / Gym': {
      extraPages: ['Classes', 'Membership'],
      sections: ['Class cards with duration and difficulty', 'Trainer profiles', 'Membership tiers', 'Weekly schedule', 'Facility amenities', 'Free trial CTA'],
      designNotes: 'Bold energetic: dark backgrounds, red/orange accents. Condensed headings (Oswald). High contrast, aggressive clip-path angles. Motivational tone.',
      reference: 'equinox, barrybootcamp',
    },
    'Real Estate': {
      extraPages: ['Listings'],
      sections: ['Featured property cards with price/beds/baths/sqft', 'Agent profile with stats', 'Neighborhood guides', 'Market stats', 'Buying/selling process steps'],
      designNotes: 'Elegant upscale: neutral palette, gold accents. Refined serif (Libre Baskerville). Large image areas. Property card overlays.',
      reference: 'compass, sothebysrealty',
    },
    'Construction / Home Services': {
      extraPages: ['Projects'],
      sections: ['Service cards with trade icons', 'Before/after project gallery', 'Process steps', 'Certifications and licenses', 'Free estimate CTA', 'Service areas'],
      designNotes: 'Rugged reliable: charcoal, orange/yellow. Sturdy serif (Roboto Slab). Trust badges prominent. Emergency callout if applicable.',
      reference: 'suffolk',
    },
    'Photography / Creative': {
      extraPages: ['Portfolio'],
      sections: ['Masonry portfolio grid', 'Service packages with pricing', 'Artist story/philosophy', 'Client testimonials as pull quotes', 'Booking CTA'],
      designNotes: 'Minimal visual-first: negative space, B&W + one accent. Clean sans-serif (DM Sans). Full-bleed gradients. Editorial/magazine feel.',
      reference: 'peterlindbergh',
    },
  };

  return industries[category] || {
    extraPages: [],
    sections: ['Adapt sections to match the specific business type'],
    designNotes: 'Clean, professional, trustworthy. Clear value proposition and CTA.',
    reference: 'stripe',
  };
}

function generateInstructionsMd(params) {
  const { businessName, slug, researchData } = params;
  const profile = researchData?.profile || {};
  const brand = researchData?.brand || {};
  const category = profile.business_type || 'Other';
  const industry = getIndustryContext(category);

  const primaryColor = brand.primary_color || '#1a365d';
  const secondaryColor = brand.secondary_color || '#2d3748';
  const accentColor = brand.accent_color || '#e53e3e';
  const headingFont = brand.heading_font || 'Merriweather';
  const bodyFont = brand.body_font || 'Source Sans Pro';

  const hasAssets = params.assetUrls?.length > 0;
  const manifest = params.assetManifest || { images: [], reviews: [] };

  return `# Build Instructions for ${businessName}

## Your Task
Customize this Vite + React + Tailwind + shadcn/ui project into a stunning, production-ready website for "${businessName}".
Read CONTEXT.md for all business data. Use EVERY piece of data — nothing should be placeholder.

## Steps
1. Read CONTEXT.md thoroughly
2. Update tailwind.config.js with brand colors and fonts
3. Update src/styles/globals.css with CSS custom properties
4. Customize every page component with real content from CONTEXT.md
5. Add industry-specific pages: ${['Home', 'About', 'Services', 'Contact', 'Privacy', 'Terms', ...industry.extraPages].join(', ')}
6. Update App.jsx routes for any new pages
7. Ensure Nav and Footer are consistent across all pages
8. Run \`npm run build\` to verify it compiles

## Brand Configuration
\`\`\`js
// tailwind.config.js theme.extend
colors: {
  primary: '${primaryColor}',
  secondary: '${secondaryColor}',
  accent: '${accentColor}',
  dark: '#050510',
}
fontFamily: {
  heading: ['${headingFont}', 'serif'],
  body: ['${bodyFont}', 'sans-serif'],
}
\`\`\`

Google Fonts URL: https://fonts.googleapis.com/css2?family=${encodeURIComponent(headingFont)}:wght@400;600;700;800;900&family=${encodeURIComponent(bodyFont)}:wght@300;400;500;600;700&display=swap

## Design Rules — $100K Agency Quality
${industry.designNotes}
Reference quality: ${industry.reference}

### CRITICAL: Dark Theme Throughout
- **EVERY section must have a dark background** — use bg-dark, bg-primary, bg-secondary, or a gradient between them
- NEVER use white or light backgrounds (bg-white, bg-gray-50, bg-gray-100) for ANY section
- Text must ALWAYS be light colored (text-white, text-white/80, text-white/60) on dark backgrounds
- If you need contrast between sections, alternate between shades of dark (bg-[#0a0a1a], bg-[#0f0f2a], bg-primary/90, bg-dark)
- Timeline sections: use dark backgrounds with accent-colored connecting lines and date badges
- Testimonial sections: dark cards with subtle borders (border-white/10), NOT white cards
- Stats/features grids: dark cards with glassmorphism (bg-white/5 backdrop-blur-md)
- The ONLY exceptions: text inside cards may be white/light, form input backgrounds may be slightly lighter (bg-white/10)

### Every page must have:
- Sticky nav with backdrop-blur, business name left, nav links right, mobile hamburger
- Footer with business info, quick links, social SVG icons, legal links, gradient top border
- Proper <title> and <meta description> unique to the page
- Smooth scroll-reveal animations (IntersectionObserver)

### Homepage sections (ALL required):
1. **Hero**: min-h-screen, gradient background (bg-gradient-to-br from-dark via-primary to-dark), animated heading, 2 CTA buttons, scroll indicator
2. **Stats bar**: bg-dark/90 py-6, 4 stats with count-up animation, accent-colored numbers
3. **About preview**: bg-[#0a0a1a], 2-column, gradient card + rich text, accent decorations
4. **Services**: bg-dark, glassmorphism cards (bg-white/5 backdrop-blur border-white/10 rounded-2xl), hover:-translate-y-2
5. **History/Timeline**: bg-[#0f0f2a], vertical timeline with accent-colored line and badges, alternating left/right, DARK background
6. **Features grid**: bg-dark, 2x4 icon + fact cards on dark
7. **Testimonials**: bg-[#0a0a1a], 3 dark quote cards (bg-white/5 border border-white/10), quotation SVG, text-white
8. **CTA banner**: bg-gradient-to-r from-primary to-accent, compelling headline, large button
9. **Contact**: bg-dark, 2-column: form on left (dark inputs bg-white/10, text-white), info cards on right
10. **Footer**: bg-[#050510], 4-column, social SVGs, legal links

### Industry-specific additions:
${industry.sections.map(s => `- ${s}`).join('\n')}

## Images — CRITICAL RULES

### REAL IMAGES ARE IN assets/ — USE THEM ALL!
The assets/ folder has been pre-populated with real photographs from multiple sources (stock photos, Google Places, Street View, AI-generated, user uploads).
**List the assets/ folder first** to see all available images. **You MUST use EVERY image** somewhere on the site.

How to use images in React (Vite — images are in public/assets/):
\`\`\`jsx
// Images are in public/assets/ — reference them with absolute paths:
<img src="/assets/stock-1.jpg" alt="Description" className="w-full h-64 object-cover rounded-xl" loading="lazy" />
// For background images:
<div style={{ backgroundImage: 'url(/assets/stock-1.jpg)' }} className="bg-cover bg-center" />
// For video:
<video autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover">
  <source src="/assets/hero-video.mp4" type="video/mp4" />
</video>
\`\`\`
**DO NOT use import statements or new URL() for images — just use /assets/filename directly.**

### Image placement strategy:
- **Hero**: Use the largest/most dramatic image as background with dark gradient overlay (bg-gradient-to-b from-dark/80 via-dark/50 to-dark)
- **About section**: Use Street View or Places photos showing the actual business
- **Image gallery/carousel**: Create a full-width section with ALL images in a horizontal scroll or grid
- **Service cards**: Use relevant images as card backgrounds with overlay text
- **Contact page**: Use the dark Mapbox map image (map-dark.png) as a full-width visual
- **Logo**: If logo-ai.png exists, use it in the nav bar

### ALL images must have:
- loading="lazy" attribute
- Proper alt text describing the image
- object-cover + explicit width/height or aspect-ratio
- Rounded corners (rounded-xl or rounded-2xl)
- Subtle shadow (shadow-lg or shadow-2xl)
- Hover zoom effect: hover:scale-105 transition-transform duration-300
### SVG Illustrations — MINIMUM 20 REQUIRED
Since we cannot hotlink stock photos, you MUST create rich SVG illustrations inline in React JSX. The site should feel visually rich, NOT like a text-only page. MINIMUM 20 unique SVG elements across the homepage:

1. **Hero section** (3+ SVGs): Create a large decorative SVG background pattern with 8+ geometric shapes — circles, rotated rectangles, hexagons, lines, at low opacity (0.05-0.15). Also add a large illustrative SVG (300x300+) representing the business. Example:
   \`\`\`jsx
   <svg className="absolute inset-0 w-full h-full opacity-10" viewBox="0 0 1200 800">
     <circle cx="200" cy="300" r="150" fill="${accentColor}" opacity="0.1" />
     <rect x="800" y="100" width="200" height="200" rx="20" fill="${primaryColor}" opacity="0.15" transform="rotate(15 900 200)" />
     {/* Add 10+ geometric shapes */}
   </svg>
   \`\`\`

2. **Service/Feature cards** (6+ SVGs): Each card MUST have a unique, detailed inline SVG illustration (64x64, NOT a Lucide icon — create custom multi-path SVGs). These should be beautiful, multi-colored, detailed illustrations. Examples:
   - Restaurant: plate with steam, wine glass, chef hat, sushi roll, flame for grill
   - Legal: scales of justice, gavel, courthouse columns, document with seal
   - Medical: stethoscope, heart with pulse line, DNA helix, shield with cross
   - Tech: code brackets, terminal cursor, connected nodes, circuit board
   - Fitness: dumbbell, running figure, yoga pose, heartbeat monitor
   - Construction: crane, hard hat, blueprint, hammer
   - Photography: camera with lens, tripod, framed photo, aperture
   - Real estate: house with key, city skyline, floor plan, sold sign

3. **About section** (2+ SVGs): Include a large decorative SVG illustration (300x300 or larger) representing the business — e.g., a stylized building, product, or abstract brand shape. Use brand colors with multiple paths and shapes.

4. **Timeline dots** (6+ SVGs): Each timeline entry MUST have a small themed SVG icon (24x24) inside the timeline dot. Each icon should be unique and relevant to that milestone.

5. **Testimonial quotes** (3+ SVGs): Use a large decorative SVG quotation mark (48x48) with brand accent color, with multiple paths for visual richness.

6. **Background decorations** (scattered throughout): Add low-opacity geometric SVG shapes (circles, hexagons, diamonds, lines) as absolute-positioned decorations in multiple sections. These add depth and make the site feel designed, not just text.

7. **Stats section** (4+ SVGs): Each stat card should have a small decorative SVG (32x32) relevant to the stat being shown.

**TOTAL: Aim for 25-40+ SVG elements across the homepage for maximum visual richness.**

### Image DON'Ts:
- NEVER use external URLs (Wikipedia, Unsplash, Pexels — they ALL block hotlinking and show broken images)
- NEVER use placeholder services (placeholder.com, via.placeholder, placehold.it)
- NEVER leave img tags with src="" or src="#"
- NEVER use Lucide icon names that don't exist — only use icons you've verified: Star, Globe, Award, Users, ArrowRight, ChevronDown, MapPin, Phone, Mail, Clock, Calendar, Building, Heart, Shield, Zap, Target, TrendingUp, CheckCircle, Plus, Minus, Menu, X, ExternalLink, Github, Twitter, Instagram, Facebook, Youtube, Linkedin, Scissors, Flame, Crown, Gem, Sparkles, Utensils, Wine, Briefcase, Scale, BookOpen, GraduationCap, Stethoscope, Activity, Dumbbell, Home, Key, Camera, Aperture, Hammer, HardHat, Palette, Code, Terminal, Layers, Grid, BarChart, PieChart, Map, Navigation, Send, MessageSquare, FileText, Lock, Unlock, Eye, Search

## ScrollToTop Component — REQUIRED
Create src/components/ScrollToTop.jsx:
\`\`\`jsx
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
export default function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [pathname]);
  return null;
}
\`\`\`
Add \`<ScrollToTop />\` inside \`<BrowserRouter>\` in App.jsx (before \`<Routes>\`).

## Page Transition Animations — REQUIRED
Every page component MUST be wrapped in a div with entrance animation:
\`\`\`jsx
<div className="animate-fadeIn" style={{ animation: 'fadeIn 0.4s ease-out' }}>
  {/* page content */}
</div>
\`\`\`
Add this keyframe to src/styles/globals.css:
\`\`\`css
@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
\`\`\`

## Contact Form — EXACT URL AND IMPLEMENTATION
The contact form MUST use this EXACT action URL:
\`\`\`
https://projectsites.dev/api/contact-form/${slug}
\`\`\`
CRITICAL contact form rules:
- All inputs MUST have name attributes: name="name", name="email", name="phone", name="message"
- Use JavaScript fetch() to POST JSON: { name, email, phone, message }
- NEVER use \`<form method="get">\` or \`<form action="/">\`
- Show a success message after successful submission (e.g., "Thank you! We'll be in touch soon.")
- Show an error message if the submission fails (e.g., "Something went wrong. Please try again.")
- Disable the submit button while sending to prevent double-submission
Example:
\`\`\`jsx
const handleSubmit = async (e) => {
  e.preventDefault();
  setSubmitting(true);
  try {
    const res = await fetch('https://projectsites.dev/api/contact-form/${slug}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, message }),
    });
    if (res.ok) setStatus('success');
    else setStatus('error');
  } catch { setStatus('error'); }
  finally { setSubmitting(false); }
};
\`\`\`

## Stats/Counters — Show Real Values by Default
Stats counters MUST render the FINAL VALUE as the default text content. The count-up animation is an enhancement only.
Even without JavaScript, the real numbers MUST be visible. NEVER start a counter at 0 as the default render.
Example:
\`\`\`jsx
<span>{visible ? animatedCount : targetValue}</span>
\`\`\`
The \`targetValue\` (e.g., "500+", "25", "4.8") is always shown until the animation starts on scroll.

## OG Image — Absolute URLs REQUIRED
All og:image meta tags MUST use absolute URLs with the full domain:
\`\`\`html
<meta property="og:image" content="https://${slug}.projectsites.dev/assets/stock-1.jpg" />
\`\`\`
NEVER use relative paths like \`/assets/stock-1.jpg\` for og:image — social media crawlers cannot resolve relative URLs.

## Accent Color for Hover States — REQUIRED
- Button hover states MUST use the site's accent color (\`${accentColor}\`), NOT purple or any hardcoded color
- Card hover borders should glow with the accent color: \`hover:border-accent hover:shadow-accent/20\`
- Focus rings MUST use accent color: \`focus:ring-accent\`
- NEVER use generic purple (\`#7c3aed\`, \`purple-500\`, etc.) for hover/focus states — always use the brand accent

## Minimum Images — REQUIRED
- The homepage MUST contain at least 10 \`<img>\` tags using real photos from public/assets/
- Create an image gallery/grid section that uses ALL available stock photos
- Every service/feature card should have an image background or photo
- The about section must include at least 2 photos
- The contact page must display the Mapbox map image (map-dark.png) if available

## Video with Poster Fallback — REQUIRED
If a hero video exists in assets/, it MUST have:
- A \`poster\` attribute pointing to the best stock image: \`poster="/assets/stock-1.jpg"\`
- The \`playsInline\` attribute for mobile compatibility
- An \`onError\` handler that hides the video and shows a gradient fallback
Example:
\`\`\`jsx
<video autoPlay muted loop playsInline poster="/assets/stock-1.jpg"
  onError={(e) => e.target.style.display='none'}
  className="absolute inset-0 w-full h-full object-cover">
  <source src="/assets/hero-video.mp4" type="video/mp4" />
</video>
\`\`\`

## Timeline Visibility — REQUIRED
- Timeline content MUST NEVER start at \`opacity: 0\`
- Use minimum \`opacity-30\` (opacity: 0.3) for any reveal animation initial state
- Content should be fully readable BEFORE the scroll animation triggers
- The animation should enhance visibility (e.g., 0.3 -> 1.0), NOT create it (0 -> 1.0)

## Legal Pages — No "projectsites.dev" References
- Privacy Policy and Terms of Service MUST NOT reference "projectsites.dev"
- Use "our website" or the business's actual domain/name instead
- Example: "By using our website, you agree to..." NOT "By using projectsites.dev..."

## Phone Links — Country Code Required
- All phone number \`tel:\` links MUST include the country code: \`tel:+1XXXXXXXXXX\`
- Format: \`<a href="tel:+12023382701">(202) 338-2701</a>\`
- NEVER use \`tel:2023382701\` without the +1 prefix

## Social Link Accessibility — REQUIRED
- All social media icon links MUST have \`aria-label="Visit us on {platform}"\`
- Example: \`<a href="https://instagram.com/business" aria-label="Visit us on Instagram" target="_blank" rel="noopener noreferrer">\`
- Every link MUST have either visible text or an aria-label for screen readers

## Hero Anchor Links — Smooth Scroll
- Hero "Explore" / "Learn More" buttons that point to sections below MUST use smooth scroll:
  \`onClick={() => document.getElementById('section-id').scrollIntoView({ behavior: 'smooth' })}\`
- NEVER use \`href="#section"\` which causes a page jump without animation in SPA routing
- Ensure the target section has the matching \`id\` attribute

${category === 'Restaurant / Café' ? `## Restaurant-Specific: Use /menu Route
- Use \`/menu\` instead of \`/services\` as the route path
- Update the nav label to "Menu" instead of "Services"
- The Menu page should display the full menu with categories, items, descriptions, and prices
` : ''}
## Content Rules
- 4000+ words of real, factual content across all pages
- ZERO placeholder text — every paragraph must be substantive
- About page: 2000+ words with real history, mission, values
- Services: each gets a full paragraph with specific details
- Use data from CONTEXT.md for all facts, numbers, quotes
- Write like a professional copywriter — compelling and authoritative

## Interactions — EVERY Element Must Feel Alive
- **Buttons**: hover (scale-105 + shadow-lg + glow), active (scale-95), focus (ring-2 ring-accent)
- **Links**: hover (text-accent + animated underline), focus (ring)
- **Cards**: hover (translateY(-8px) + shadow-2xl + border-glow), transition-all duration-300
- **Smooth scroll**: ALL same-page links must use scrollIntoView({ behavior: 'smooth' }) — NO #href jumps
- **Nav links**: smooth scroll to sections when clicking anchors
- **Address links**: wrap in <a href="https://maps.google.com/?q={encoded_address}" target="_blank">
- **Phone links**: wrap in <a href="tel:{phone}">
- **Email links**: wrap in <a href="mailto:{email}">

## Reviews & Rich Snippets
${(manifest.placesRating || manifest.yelpRating) ? `- Display "${manifest.placesRating || manifest.yelpRating}/5 stars" with filled/empty star SVGs
- Include AggregateRating in JSON-LD: ratingValue=${manifest.placesRating || manifest.yelpRating}, reviewCount=${(manifest.placesReviewCount || 0) + (manifest.yelpReviewCount || 0)}
- Show real review quotes from CONTEXT.md as testimonial cards` : '- If no reviews available, use industry-appropriate testimonial-style quotes'}

## SEO
- JSON-LD LocalBusiness schema with ALL available data: name, address, phone, hours, geo, rating, reviewCount
- Rich snippets: aggregateRating so Google shows stars in search results
- og:title, og:description, og:image (use hero image URL), og:url on every page
- Semantic HTML: header, nav, main, section, article, footer
- Alt text on all images, ARIA labels on interactive elements
- Canonical URL: https://${slug}.projectsites.dev

## Technical
- Use existing shadcn/ui components: Button, Card (in src/components/ui/)
- Add more shadcn/ui components as needed in src/components/ui/
- Use Lucide React icons — import by EXACT name: import { Star, Globe, Award } from 'lucide-react'
- Do NOT use icon names like Code2, ArrowUpRight, or other variants that may not exist in this version
- Use React Router for navigation (already configured)
- All animations: CSS @keyframes + IntersectionObserver
- Mobile-first responsive (hamburger menu, stacked layouts, min 44px touch targets)
- After writing all files, run \`npm run build\`. If it fails, FIX the errors and try again.
- COMMON BUILD ERROR: "@import must precede all other statements" — this happens when you put @import in CSS after @tailwind directives. NEVER use @import in CSS files. Load Google Fonts via <link> tag in index.html instead:
  \`\`\`html
  <link href="https://fonts.googleapis.com/css2?family=FONT:wght@400;600;700&display=swap" rel="stylesheet">
  \`\`\`

## Self-Check Before Build
Before running \`npm run build\`, review your work:
1. Does every section in Home.jsx have a dark background class? (bg-dark, bg-[#0a0a1a], etc.)
2. Are there at least 20 inline SVGs with viewBox across the homepage?
3. Does the contact form use fetch() to POST JSON to \`https://projectsites.dev/api/contact-form/${slug}\`? (NOT method="get", NOT action="/")
4. Do all contact form inputs have name attributes? (name="name", name="email", name="phone", name="message")
5. Are all Lucide icon imports valid? (Only use: Star, Globe, Award, Users, ArrowRight, ChevronDown, MapPin, Phone, Mail, Clock, Calendar, Building, Heart, Shield, Zap, Target, TrendingUp, CheckCircle, Menu, X, Send, MessageSquare, Scissors, Flame, Crown, Gem, Sparkles, Utensils, Wine, Briefcase, Scale, BookOpen, Stethoscope, Activity, Dumbbell, Home as HomeIcon, Key, Camera, Hammer, Palette, Code, Terminal, Layers, Grid, BarChart, Map, Navigation, FileText, Lock, Eye, Search, ExternalLink)
6. Is the JSON-LD schema present on the homepage?
7. Does every page have a unique <title> and <meta description>?
8. Does ScrollToTop.jsx exist and is it added inside BrowserRouter in App.jsx?
9. Does every page component wrap its content in a fadeIn animation div?
10. Do stats/counters show the real final value as default (not 0)?
11. Are all og:image tags using absolute URLs? (https://${slug}.projectsites.dev/assets/...)
12. Do button hover states use the accent color (not purple)?
13. Are there at least 10 <img> tags on the homepage using real photos?
14. Does the hero video (if present) have poster, playsInline, and onError attributes?
15. Do timeline items start at opacity-30 or higher (NEVER opacity-0)?
16. Do Privacy/Terms pages avoid mentioning "projectsites.dev"?
17. Do all tel: links include country code (+1)?
18. Do all social icon links have aria-label attributes?
19. Do hero anchor buttons use scrollIntoView (not href="#")?
If any check fails, fix it before building.
`;
}

// ═══════════════════════════════════════════════════════════════
// BUILD PIPELINE
// ═══════════════════════════════════════════════════════════════

async function handleBuild(params) {
  const { slug, siteId, businessName, businessWebsite, additionalContext, researchData, assetUrls, structurePlan, scrapedContent } = params;
  const buildId = Date.now();
  const outputDir = `/tmp/claude-build-${slug}-${buildId}`;
  const startTime = Date.now();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`BUILD: ${businessName} (${slug})`);
  console.log(`${'═'.repeat(60)}\n`);

  // ── Phase 1: Deterministic Setup (no Claude Code needed) ──
  console.log(`[1/6] Cloning template + installing dependencies...`);

  try {
    execSync(`git clone --depth 1 ${TEMPLATE_REPO} "${outputDir}"`, {
      stdio: 'pipe', timeout: 30000, env: { ...process.env },
    });
    // Remove .git to avoid confusion
    execSync(`rm -rf "${outputDir}/.git"`, { stdio: 'pipe' });
    console.log(`  → Template cloned`);
  } catch (err) {
    console.warn(`  → Clone failed, creating from scratch: ${err.message?.substring(0, 100)}`);
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // npm install (if package.json exists)
  if (fs.existsSync(path.join(outputDir, 'package.json'))) {
    try {
      execSync('npm install --legacy-peer-deps', {
        cwd: outputDir, stdio: 'pipe', timeout: 120000, env: { ...process.env },
      });
      console.log(`  → Dependencies installed`);
    } catch (err) {
      console.warn(`  → npm install warning: ${err.message?.substring(0, 100)}`);
    }
  }

  // ── Phase 1b: Collect multimedia assets from 14 APIs ──
  console.log(`[2/6] Collecting multimedia assets from APIs...`);
  const profile = researchData?.profile || {};
  const brand = researchData?.brand || {};

  let assetManifest = null;
  // Assets go into public/ so Vite copies them to dist/ automatically
  const publicAssetsDir = path.join(outputDir, 'public', 'assets');
  fs.mkdirSync(publicAssetsDir, { recursive: true });

  try {
    assetManifest = await collectAssets({
      slug,
      businessName,
      businessType: profile.business_type || 'Business',
      address: typeof profile.address === 'string' ? profile.address : (profile.address ? JSON.stringify(profile.address) : ''),
      phone: profile.phone || '',
      website: cleanUrl(businessWebsite || ''),
      accentColor: (brand.accent_color || '#e53e3e').replace('#', ''),
      outputDir,
    });

    // Move assets from assets/ to public/assets/ so Vite copies them to dist/
    const srcAssets = path.join(outputDir, 'assets');
    if (fs.existsSync(srcAssets)) {
      for (const file of fs.readdirSync(srcAssets)) {
        if (file.startsWith('_')) continue; // skip manifest
        const src = path.join(srcAssets, file);
        const dst = path.join(publicAssetsDir, file);
        try { fs.copyFileSync(src, dst); } catch {}
      }
      console.log(`  → Copied ${fs.readdirSync(publicAssetsDir).length} assets to public/assets/`);
    }
    console.log(`  → Collected ${assetManifest.images?.length || 0} images, ${assetManifest.videos?.length || 0} videos`);
    if (assetManifest.reviews?.length) console.log(`  → ${assetManifest.reviews.length} reviews, rating: ${assetManifest.rating || 'N/A'}`);
    if (assetManifest.logo) console.log(`  → Logo: ${assetManifest.logo}`);
    if (assetManifest.mapImage) console.log(`  → Map image: ${assetManifest.mapImage}`);
  } catch (err) {
    console.warn(`  → Asset collection failed (non-blocking): ${err.message}`);
    assetManifest = { images: [], videos: [], reviews: [] };
  }

  // Also copy any form-submitted assets from assetUrls to assets/
  if (assetUrls?.length) {
    const assetsDir = path.join(outputDir, 'assets');
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
    for (let i = 0; i < assetUrls.length; i++) {
      const a = assetUrls[i];
      const url = a.url || a;
      try {
        const res = await fetch(url);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const ext = (a.name || 'upload').split('.').pop() || 'jpg';
          const fname = `upload-${i + 1}.${ext}`;
          fs.writeFileSync(path.join(assetsDir, fname), buf);
          assetManifest.images.push({ path: `assets/${fname}`, source: 'user-upload', name: a.name || fname });
          console.log(`  → Downloaded user upload: ${fname}`);
        }
      } catch { /* skip failed downloads */ }
    }
  }

  // ── Phase 1c: Write context files ──
  console.log(`[3/6] Writing context files...`);

  // CONTEXT.md — all business data pre-formatted (now includes asset manifest)
  const contextMd = generateContextMd({ ...params, assetManifest });
  fs.writeFileSync(path.join(outputDir, 'CONTEXT.md'), contextMd);
  console.log(`  → CONTEXT.md (${contextMd.length} chars)`);

  // INSTRUCTIONS.md — what Claude Code should do (now with real image refs)
  const instructionsMd = generateInstructionsMd({ ...params, assetManifest });
  fs.writeFileSync(path.join(outputDir, 'INSTRUCTIONS.md'), instructionsMd);
  console.log(`  → INSTRUCTIONS.md (${instructionsMd.length} chars)`);

  // Raw research data for reference
  fs.writeFileSync(path.join(outputDir, '_research.json'), JSON.stringify(researchData || {}, null, 2));

  // Structure plan if available
  if (structurePlan) {
    fs.writeFileSync(path.join(outputDir, '_structure-plan.json'), JSON.stringify(structurePlan, null, 2));
  }

  // Scraped content if available
  if (scrapedContent) {
    fs.writeFileSync(path.join(outputDir, '_scraped-content.md'), typeof scrapedContent === 'string' ? scrapedContent : JSON.stringify(scrapedContent));
    console.log(`  → Scraped content (${typeof scrapedContent === 'string' ? scrapedContent.length : JSON.stringify(scrapedContent).length} chars)`);
  }

  // ── Phase 2: Claude Code — ONE focused call ──
  const totalImages = assetManifest?.images?.length || 0;
  console.log(`[4/6] Running Claude Code CLI (${totalImages} images available)...`);

  const claudePrompt = `You are building a website for "${businessName}".

STEP 1: Read INSTRUCTIONS.md for complete build steps and design rules.
STEP 2: Read CONTEXT.md for all business data, reviews, ratings, and available images.
${scrapedContent ? 'STEP 3: Read _scraped-content.md for existing website content to clone and improve.' : ''}

CRITICAL — IMAGES: The public/assets/ folder contains ${totalImages} real photographs.
List public/assets/ to see them. Use EVERY image on the website.
Reference images as: src="/assets/stock-1.jpg" (they are in public/ so Vite serves them at /assets/).
DO NOT use import statements or new URL() for images. Just use /assets/filename.jpg directly.

CRITICAL — CUSTOMIZE EVERY FILE: You MUST edit ALL of these files with real content:
- src/pages/Home.jsx — full homepage with 10+ sections, all ${totalImages} images used
- src/pages/About.jsx — 2000+ words of real history and facts about ${businessName}
- src/pages/Services.jsx — detailed service descriptions from CONTEXT.md
- src/pages/Contact.jsx — contact form, address linked to Google Maps, phone as tel: link
- src/pages/Privacy.jsx — real privacy policy with ${businessName} details
- src/pages/Terms.jsx — real terms of service with ${businessName} details
- src/components/Nav.jsx — real business name, not "Business Name"
- src/components/Footer.jsx — real address, phone, email, social links
- tailwind.config.js — brand colors from CONTEXT.md
- index.html — real <title> with "${businessName}", meta description, OG tags

NEVER use placeholder text like "Business Name", "Address here", "replace this".
NEVER use template variables like {{BUSINESS_NAME}}.
Write the ACTUAL business name "${businessName}" everywhere.

After customizing ALL files, run \`npm run build\` to verify it compiles.
If the build fails, fix the error and run build again.`;

  try {
    const result = execSync(
      `echo ${JSON.stringify(claudePrompt)} | ${CLAUDE_BIN} --dangerously-skip-permissions -p`,
      {
        cwd: outputDir,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          HOME: process.env.HOME || '/Users/apple',
          PATH: process.env.PATH,
        },
        timeout: 900000, // 15 minutes
        maxBuffer: 100 * 1024 * 1024,
        shell: true,
      }
    );
    console.log(`  → Claude Code completed (${result.length} bytes output)`);
  } catch (err) {
    console.warn(`  → Claude Code exited with status ${err.status || 'unknown'}`);
    // Check if files were written despite exit code
    if (err.stdout) {
      console.log(`  → stdout: ${err.stdout.toString().length} bytes`);
    }
  }

  // ── Phase 2b: Build if not already built ──
  const distDir = path.join(outputDir, 'dist');
  if (!fs.existsSync(distDir) && fs.existsSync(path.join(outputDir, 'package.json'))) {
    console.log(`  → Running npm run build...`);
    try {
      execSync('npm run build', {
        cwd: outputDir, stdio: 'pipe', timeout: 60000, env: { ...process.env },
      });
      console.log(`  → Build successful`);
    } catch (buildErr) {
      console.warn(`  → Build failed: ${buildErr.message?.substring(0, 200)}`);
      // If build fails, check if there's an index.html in the root (fallback)
      if (!fs.existsSync(path.join(outputDir, 'index.html'))) {
        console.warn(`  → No index.html found either — build completely failed`);
      }
    }
  }

  // ── Quality Gate: Reject empty/template builds ──
  const homeJsx = path.join(outputDir, 'src/pages/Home.jsx');
  const indexHtml = path.join(outputDir, distDir ? 'dist/index.html' : 'index.html');
  let passedQuality = true;

  // Check Home.jsx has real content (not template placeholder)
  if (fs.existsSync(homeJsx)) {
    const homeContent = fs.readFileSync(homeJsx, 'utf-8');
    const homeSize = homeContent.length;
    // Check for literal placeholder text in JSX return statements (not in comments/strings)
    const jsxContent = homeContent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, ''); // strip comments
    const hasPlaceholder = />\s*Business Name\s*<|>\s*Address here\s*<|>\s*replace this\s*<|{{[A-Z_]+}}/i.test(jsxContent);
    const hasBusinessName = homeContent.toLowerCase().includes(businessName.toLowerCase().substring(0, 10));

    if (homeSize < 5000) {
      console.warn(`  ⚠️ QUALITY GATE: Home.jsx too small (${homeSize} bytes) — likely template only`);
      passedQuality = false;
    }
    if (hasPlaceholder) {
      console.warn(`  ⚠️ QUALITY GATE: Home.jsx contains placeholder text`);
      passedQuality = false;
    }
    if (!hasBusinessName && homeSize < 10000) {
      console.warn(`  ⚠️ QUALITY GATE: Home.jsx doesn't mention "${businessName}"`);
      passedQuality = false;
    }
  } else {
    console.warn(`  ⚠️ QUALITY GATE: Home.jsx not found`);
    passedQuality = false;
  }

  // Check that at least 4 pages were customized (>1KB each)
  const pagesDir = path.join(outputDir, 'src/pages');
  if (fs.existsSync(pagesDir)) {
    const pages = fs.readdirSync(pagesDir).filter(f => f.endsWith('.jsx'));
    const customized = pages.filter(f => {
      try { return fs.statSync(path.join(pagesDir, f)).size > 1000; } catch { return false; }
    });
    if (customized.length < 4) {
      console.warn(`  ⚠️ QUALITY GATE: Only ${customized.length}/${pages.length} pages customized (need 4+)`);
      passedQuality = false;
    }
  }

  // Check minimum media assets in public/assets/
  const publicAssets = path.join(outputDir, 'public', 'assets');
  const imageCount = fs.existsSync(publicAssets) ?
    fs.readdirSync(publicAssets).filter(f => /\.(jpg|jpeg|png|webp|mp4)$/i.test(f)).length : 0;
  if (imageCount < 3) {
    console.warn(`  ⚠️ QUALITY GATE: Only ${imageCount} media assets in public/assets/ (need 3+)`);
    passedQuality = false;
  }

  if (!passedQuality) {
    console.warn(`  ❌ QUALITY GATE FAILED — site not published. Setting status to 'error'.`);
    await d1Query(
      `UPDATE sites SET status = 'error', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      [siteId]
    );
    console.log(`   Build dir preserved for inspection: ${outputDir}`);
    return { error: 'quality-gate-failed', slug, outputDir };
  }

  console.log(`  ✅ Quality gate passed`);

  // ── Phase 3: Upload to R2 ──
  console.log(`[5/6] Uploading to R2...`);

  // Prefer dist/ (Vite build output), fall back to root
  const uploadDir = fs.existsSync(distDir) ? distDir : outputDir;
  console.log(`  Uploading from: ${uploadDir === distDir ? 'dist/' : 'root'}`);

  const files = readFilesRecursive(uploadDir)
    .filter(f => !f.name.startsWith('_') && !f.name.startsWith('.') && !f.name.includes('node_modules') && !f.name.includes('CONTEXT') && !f.name.includes('INSTRUCTIONS'));

  const version = new Date().toISOString().replace(/[:.]/g, '-');
  let uploaded = 0;

  for (const file of files) {
    const key = `sites/${slug}/${version}/${file.name}`;
    const ext = path.extname(file.name);
    const ct = {
      '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
      '.mjs': 'application/javascript', '.json': 'application/json',
      '.xml': 'application/xml', '.txt': 'text/plain', '.svg': 'image/svg+xml',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2',
      '.woff': 'font/woff', '.ttf': 'font/ttf',
    }[ext] || 'application/octet-stream';

    // Binary files (images, fonts) — use file path directly
    const isBinary = ['.png', '.jpg', '.jpeg', '.ico', '.webp', '.woff2', '.woff', '.ttf', '.gif'].includes(ext);
    let ok;
    if (isBinary) {
      ok = await r2PutBinary(key, file.fullPath, ct);
    } else {
      ok = await r2Put(key, file.content, ct);
    }
    if (ok) uploaded++;
  }

  // Ensure robots.txt and sitemap.xml exist
  if (!files.some(f => f.name === 'robots.txt')) {
    const robots = `User-agent: *\nAllow: /\n\nSitemap: https://${slug}.projectsites.dev/sitemap.xml`;
    if (await r2Put(`sites/${slug}/${version}/robots.txt`, robots, 'text/plain')) uploaded++;
    files.push({ name: 'robots.txt', content: robots });
  }

  if (!files.some(f => f.name === 'sitemap.xml')) {
    const htmlFiles = files.filter(f => f.name.endsWith('.html')).map(f => f.name);
    const now = new Date().toISOString().split('T')[0];
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${htmlFiles.map(p => `  <url>\n    <loc>https://${slug}.projectsites.dev/${p === 'index.html' ? '' : p}</loc>\n    <lastmod>${now}</lastmod>\n  </url>`).join('\n')}\n</urlset>`;
    if (await r2Put(`sites/${slug}/${version}/sitemap.xml`, sitemap, 'application/xml')) uploaded++;
    files.push({ name: 'sitemap.xml', content: sitemap });
  }

  // Upload manifest
  await r2Put(`sites/${slug}/_manifest.json`, JSON.stringify({
    current_version: version,
    updated_at: new Date().toISOString(),
    files: files.map(f => f.name),
    model: 'claude-code-cli',
    build_time_ms: Date.now() - startTime,
  }), 'application/json');

  // ── Phase 4: Update D1 status ──
  console.log(`[6/6] Updating database...`);
  await d1Query(
    `UPDATE sites SET status = 'published', current_build_version = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    [version, siteId]
  );

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n✅ DONE: ${uploaded}/${files.length} files uploaded in ${elapsed}s`);
  console.log(`   Live: https://${slug}.projectsites.dev`);
  console.log(`   Build dir: ${outputDir}\n`);

  return { files: files.length, uploaded, slug, version, elapsed_seconds: elapsed };
}

function readFilesRecursive(dir, prefix = '') {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return results; }

  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      results.push(...readFilesRecursive(fullPath, rel));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      const isBinary = ['.png', '.jpg', '.jpeg', '.ico', '.webp', '.woff2', '.woff', '.ttf', '.gif'].includes(ext);
      if (isBinary) {
        results.push({ name: rel, fullPath, content: null });
      } else {
        try { results.push({ name: rel, fullPath, content: fs.readFileSync(fullPath, 'utf-8') }); }
        catch { /* skip unreadable */ }
      }
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════
// HTTP SERVER
// ═══════════════════════════════════════════════════════════════

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'GET' && req.url === '/health') {
    return res.end(JSON.stringify({ status: 'ok', agent: 'claude-code-local-v2' }));
  }

  if (req.method === 'POST' && req.url === '/build') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      const params = JSON.parse(body);
      res.writeHead(202);
      res.end(JSON.stringify({ status: 'building', slug: params.slug }));
      try {
        await handleBuild(params);
      } catch (err) {
        console.error(`BUILD FAILED: ${err.message}`);
        await d1Query(
          `UPDATE sites SET status = 'error', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
          [params.siteId]
        ).catch(() => {});
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`\n🏗️  Claude Code Build Agent v2 running at http://localhost:${PORT}`);
  console.log(`   Optimized: pre-scaffold → context files → ONE Claude Code call`);
  console.log(`   Waiting for build jobs from projectsites.dev...\n`);
});
