/**
 * Industry-specific prompts for Stage 2 of the 3-stage build pipeline.
 * Each prompt adds category-specific sections, design patterns, and content strategies.
 * Reference sites included for each category so Claude Code knows the quality bar.
 */

export const INDUSTRY_PROMPTS = {
  'Restaurant / Café': {
    reference: 'https://www.nomacopenhagen.dk or https://www.eleven-madison-park.com',
    prompt: `INDUSTRY: Restaurant / Café

RESTAURANT-SPECIFIC SECTIONS (add these to the master blueprint):
- MENU SECTION: Elegant menu layout with categories (Appetizers, Mains, Desserts, Drinks). Each item: name, description, price. Use a 2-column layout on desktop. Style: elegant serif font for item names, italic descriptions, price aligned right.
- CHEF/TEAM SECTION: Head chef spotlight with bio paragraph. Team grid if multiple staff.
- AMBIANCE GALLERY: CSS gradient cards representing interior, exterior, plating shots. Warm color overlays.
- RESERVATIONS CTA: Prominent booking button/section. "Reserve Your Table" with date/time/party-size concept.
- HOURS & LOCATION: Daily hours prominently displayed. Map placeholder with directions.

DESIGN ADJUSTMENTS:
- Warm color palette: use rich browns, golds, deep reds, cream backgrounds
- Typography: Playfair Display or similar elegant serif for headings
- Consider dark/moody theme for fine dining, bright/fresh for cafés
- Food photography placeholders: warm gradient cards with descriptive text
- Include dietary icons (V, VG, GF) concept in menu if applicable`,
  },

  'Salon / Barbershop': {
    reference: 'https://www.blindbarber.com or https://www.fellowbarber.com',
    prompt: `INDUSTRY: Salon / Barbershop

SALON-SPECIFIC SECTIONS:
- SERVICES & PRICING: Clean price list with service name, description, duration, price. Group by category (Cuts, Color, Treatments, Grooming).
- STYLISTS/TEAM: Grid of team members with name, title, specialty, and gradient avatar placeholder.
- BEFORE/AFTER GALLERY: Side-by-side comparison concept cards.
- BOOKING CTA: "Book Your Appointment" prominent button/section.
- PRODUCTS: If they sell products, a small showcase section.

DESIGN ADJUSTMENTS:
- Sleek, premium aesthetic: dark backgrounds, gold/copper accents
- Typography: Cormorant Garamond or elegant serif headings
- Monochrome with one accent color (gold, rose gold, or copper)
- Clean lines, lots of whitespace
- Instagram-style grid layout for portfolio`,
  },

  'Legal / Law Firm': {
    reference: 'https://www.cravath.com or https://www.skadden.com',
    prompt: `INDUSTRY: Legal / Law Firm

LEGAL-SPECIFIC SECTIONS:
- PRACTICE AREAS: Grid of practice area cards (Corporate, Litigation, Real Estate, etc.) with icon + description.
- ATTORNEY PROFILES: Professional team section with name, title, education, bar admissions.
- CASE RESULTS/WINS: Notable achievements or case outcomes (anonymized).
- FREE CONSULTATION CTA: Prominent "Schedule a Free Consultation" section.
- CLIENT TESTIMONIALS: Professional testimonial cards with case type context.
- RESOURCES/INSIGHTS: Blog preview or legal resources section.

DESIGN ADJUSTMENTS:
- Professional, trustworthy: navy blue, charcoal, gold accents
- Typography: Merriweather or traditional serif headings
- Conservative layout, generous whitespace
- No flashy animations — subtle, professional transitions
- Credentialing badges: Bar Association, awards, certifications`,
  },

  'Medical / Healthcare': {
    reference: 'https://www.mayoclinic.org or https://www.clevelandclinic.org',
    prompt: `INDUSTRY: Medical / Healthcare

MEDICAL-SPECIFIC SECTIONS:
- SERVICES/SPECIALTIES: Clean grid of medical services with medical icons.
- PROVIDERS: Doctor/provider profiles with credentials, specialties, education.
- PATIENT RESOURCES: Insurance accepted, forms, patient portal link placeholders.
- APPOINTMENT BOOKING: "Schedule an Appointment" with phone + online options.
- HEALTH & SAFETY: COVID/safety protocols, HIPAA compliance notice.
- TESTIMONIALS: Patient satisfaction scores, review highlights.

DESIGN ADJUSTMENTS:
- Clean, calming: light blues, whites, soft greens
- Typography: Poppins or clean sans-serif — conveys modern healthcare
- Lots of whitespace, calming color palette
- Trust signals: board certifications, hospital affiliations
- HIPAA compliance notice in footer
- Accessibility is extra important — WCAG AA minimum`,
  },

  'Technology / SaaS': {
    reference: 'https://vercel.com or https://linear.app',
    prompt: `INDUSTRY: Technology / SaaS

TECH-SPECIFIC SECTIONS:
- FEATURES: Bento grid layout showcasing product features with icons + descriptions.
- HOW IT WORKS: 3-step process with numbered circles and connecting lines.
- PRICING TIERS: 3-column pricing table (Free, Pro, Enterprise) with feature comparison.
- INTEGRATIONS: Logo grid of integration partners (use gradient placeholder cards).
- DEVELOPER DOCS: Link to documentation, API reference.
- OPEN SOURCE: If applicable, GitHub stars, contributor count.

DESIGN ADJUSTMENTS:
- Futuristic, minimal: dark backgrounds (#0a0a0a), neon accents (blue, purple, green)
- Typography: Space Grotesk, Inter, or JetBrains Mono for code
- Glassmorphism cards, gradient borders, glow effects
- Code snippets styled with syntax highlighting colors
- Terminal/CLI aesthetic elements
- Animated gradients, particle effects concept`,
  },

  'Fitness / Gym': {
    reference: 'https://www.equinox.com or https://www.barrybootcamp.com',
    prompt: `INDUSTRY: Fitness / Gym

FITNESS-SPECIFIC SECTIONS:
- CLASSES/PROGRAMS: Grid of class cards with name, description, duration, difficulty level.
- TRAINERS: Trainer profiles with specialties, certifications, bio.
- MEMBERSHIP PLANS: 2-3 tier pricing cards with features.
- CLASS SCHEDULE: Weekly schedule grid or list.
- FACILITY: Feature list with amenities (Pool, Sauna, Free Weights, etc.).
- FREE TRIAL CTA: "Start Your Free Trial" prominent section.
- TRANSFORMATION: Success stories / before-after concept.

DESIGN ADJUSTMENTS:
- Bold, energetic: dark backgrounds, bright red/orange accents
- Typography: Oswald, Bebas Neue, or bold condensed headings
- High contrast, aggressive angles (clip-path slants)
- Dynamic animations — elements that feel powerful
- Motivational tone in copy`,
  },

  'Real Estate': {
    reference: 'https://www.compass.com or https://www.sothebysrealty.com',
    prompt: `INDUSTRY: Real Estate

REAL-ESTATE-SPECIFIC SECTIONS:
- FEATURED LISTINGS: Property cards with gradient placeholders, price, beds/baths/sqft.
- AGENT PROFILE: Detailed agent bio with stats (years experience, transactions, volume).
- NEIGHBORHOOD GUIDES: Area spotlight cards with description.
- MARKET STATS: Key numbers (avg price, days on market, sold this year).
- SEARCH CTA: "Find Your Dream Home" prominent search concept.
- TESTIMONIALS: Client success stories with property type context.
- PROCESS: "How I Work" — step-by-step buying/selling process.

DESIGN ADJUSTMENTS:
- Elegant, upscale: neutral palette (charcoal, cream, gold)
- Typography: Libre Baskerville or refined serif
- Large image areas (gradient placeholders for property photos)
- Property card design: price overlay, badge for status (For Sale, Sold, etc.)
- Map integration placeholder`,
  },

  'Construction / Home Services': {
    reference: 'https://www.suffolk.com or established contractor sites',
    prompt: `INDUSTRY: Construction / Home Services

CONSTRUCTION-SPECIFIC SECTIONS:
- SERVICES: Grid of service cards (Plumbing, Electrical, Roofing, etc.) with trade icons.
- PROJECT GALLERY: Before/after concept cards for completed projects.
- PROCESS: "How We Work" — step-by-step (Consultation → Quote → Build → Inspect).
- CERTIFICATIONS: License numbers, insurance badges, BBB rating.
- FREE ESTIMATE CTA: "Get Your Free Estimate" prominent form.
- SERVICE AREAS: Map or list of areas served.

DESIGN ADJUSTMENTS:
- Rugged, reliable: charcoal, orange/yellow accents, industrial feel
- Typography: Roboto Slab or sturdy serif headings
- Strong, confident imagery concepts
- Trust signals prominent: licensed, bonded, insured badges
- Emergency services callout if applicable`,
  },

  'Photography / Creative': {
    reference: 'https://www.peterlindbergh.com or portfolio sites on Awwwards',
    prompt: `INDUSTRY: Photography / Creative

CREATIVE-SPECIFIC SECTIONS:
- PORTFOLIO: Masonry grid layout with gradient placeholder cards + category labels.
- PACKAGES: 2-3 service packages with details and starting price.
- ABOUT THE ARTIST: Personal story, style, philosophy — more editorial.
- CLIENT LOVE: Testimonials styled as pull quotes.
- BOOKING: "Let's Create Together" CTA with availability mention.

DESIGN ADJUSTMENTS:
- Minimal, visual-first: lots of negative space, black/white with one accent
- Typography: DM Sans or clean minimal sans-serif
- Full-bleed image areas (gradient placeholders)
- Grid-heavy layout — the work is the design
- Subtle hover reveals on portfolio items
- Editorial/magazine aesthetic`,
  },

  'Other': {
    reference: 'https://stripe.com — clean, professional, universal',
    prompt: `INDUSTRY: General Business

Use the master blueprint as-is with these additions:
- Ensure all sections from the master are present
- Adapt tone to match the business type from research data
- Include industry-appropriate icons and content
- Professional, clean, trustworthy aesthetic
- Focus on clear value proposition and CTA`,
  },
};

/**
 * Get the industry-specific prompt for a category.
 */
export function getIndustryPrompt(category) {
  return INDUSTRY_PROMPTS[category] || INDUSTRY_PROMPTS['Other'];
}
