#!/usr/bin/env node
/**
 * Trigger builds for all 10 industry categories through the local agent.
 * Each build uses real business data to test the prompt system.
 */

const AGENT_URL = 'http://localhost:4400/build';

// One sample business per industry category
const BUILDS = [
  {
    slug: 'nobu-v3',
    siteId: 'cat-restaurant-001',
    businessName: 'Nobu Restaurant',
    businessWebsite: 'https://www.noburestaurants.com',
    additionalContext: 'Upscale Japanese fusion restaurant by Chef Nobu Matsuhisa. Known for Black Cod Miso, yellowtail sashimi with jalapeño. Multiple locations worldwide. Celebrity clientele. Robert De Niro co-owner.',
    researchData: {
      profile: {
        business_type: 'Restaurant / Café',
        business_name: 'Nobu Restaurant',
        description: 'World-renowned Japanese-Peruvian fusion restaurant founded by Chef Nobuyuki Matsuhisa. Famous for innovative dishes blending traditional Japanese techniques with South American flavors.',
        established_year: 1994,
        address: '195 Broadway, New York, NY 10007',
        phone: '(212) 219-0500',
        email: 'reservations@noburestaurants.com',
        services: [
          { name: 'Fine Dining', description: 'Multi-course omakase and à la carte dining experience', price: '$$$' },
          { name: 'Private Events', description: 'Exclusive private dining rooms for celebrations and corporate events' },
          { name: 'Bar & Lounge', description: 'Craft cocktails with Japanese-inspired ingredients' },
          { name: 'Takeout', description: 'Signature dishes available for pickup' },
        ],
        hours: [
          { day: 'Monday', open: '5:00 PM', close: '11:00 PM' },
          { day: 'Tuesday', open: '5:00 PM', close: '11:00 PM' },
          { day: 'Wednesday', open: '5:00 PM', close: '11:00 PM' },
          { day: 'Thursday', open: '5:00 PM', close: '11:00 PM' },
          { day: 'Friday', open: '5:00 PM', close: '12:00 AM' },
          { day: 'Saturday', open: '5:00 PM', close: '12:00 AM' },
          { day: 'Sunday', open: '5:00 PM', close: '10:00 PM' },
        ],
      },
      brand: {
        primary_color: '#1a1a1a',
        secondary_color: '#c9a96e',
        accent_color: '#d4af37',
        heading_font: 'Playfair Display',
        body_font: 'Lato',
        style_notes: 'Elegant, minimalist Japanese aesthetic. Dark backgrounds with gold accents.',
      },
      sellingPoints: {
        selling_points: [
          { headline: 'World-Famous Black Cod Miso', description: 'The signature dish that launched a culinary empire — buttery miso-marinated black cod, slow-roasted to perfection.' },
          { headline: 'Celebrity Chef Founded', description: 'Founded by Chef Nobuyuki "Nobu" Matsuhisa with Robert De Niro. Over 50 locations across 5 continents.' },
          { headline: 'Japanese-Peruvian Fusion', description: 'A unique culinary tradition born from Chef Nobu\'s years in Peru, blending umami-rich Japanese technique with bold South American flavors.' },
        ],
        hero_slogans: ['Where East Meets South America', 'The Art of Japanese-Peruvian Cuisine'],
      },
      social: {
        website_url: 'https://www.noburestaurants.com',
        social_links: [
          { platform: 'Instagram', url: 'https://instagram.com/noburestaurants' },
          { platform: 'Facebook', url: 'https://facebook.com/noburestaurants' },
          { platform: 'Twitter', url: 'https://twitter.com/noaborestaurants' },
        ],
      },
      images: {},
    },
    assetUrls: [],
  },
  {
    slug: 'vitos-salon-v2',
    siteId: 'cat-salon-001',
    businessName: "Vito's Men's Salon",
    businessWebsite: '',
    additionalContext: "Traditional Italian-style men's barbershop and salon in Lake Hiawatha, NJ. Old-school barbering with modern style. Hot towel shaves, precision cuts, beard grooming.",
    researchData: {
      profile: {
        business_type: 'Salon / Barbershop',
        business_name: "Vito's Men's Salon",
        description: "Premium men's grooming destination offering traditional barbering with a modern twist. Known for precision cuts, hot towel shaves, and exceptional service.",
        address: '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034',
        phone: '(973) 335-8211',
        services: [
          { name: 'Classic Haircut', description: 'Precision cut with hot towel, scalp massage', price: '$25' },
          { name: 'Hot Towel Shave', description: 'Traditional straight razor shave with warm lather', price: '$30' },
          { name: 'Beard Trim & Shape', description: 'Expert beard sculpting and grooming', price: '$15' },
          { name: 'Hair & Beard Combo', description: 'Full haircut with beard trim and shape', price: '$35' },
          { name: 'Kids Haircut', description: 'Haircut for children 12 and under', price: '$18' },
        ],
        hours: [
          { day: 'Monday', open: 'Closed', close: 'Closed' },
          { day: 'Tuesday', open: '9:00 AM', close: '7:00 PM' },
          { day: 'Wednesday', open: '9:00 AM', close: '7:00 PM' },
          { day: 'Thursday', open: '9:00 AM', close: '7:00 PM' },
          { day: 'Friday', open: '9:00 AM', close: '7:00 PM' },
          { day: 'Saturday', open: '8:00 AM', close: '5:00 PM' },
          { day: 'Sunday', open: 'Closed', close: 'Closed' },
        ],
      },
      brand: {
        primary_color: '#1c1c1c',
        secondary_color: '#8b7355',
        accent_color: '#c9a96e',
        heading_font: 'Cormorant Garamond',
        body_font: 'Montserrat',
        style_notes: 'Classic barbershop meets modern luxury. Dark tones, gold/copper accents.',
      },
      sellingPoints: {
        selling_points: [
          { headline: 'Old-School Craft, Modern Style', description: 'Traditional Italian barbering techniques perfected over decades, combined with contemporary trends.' },
          { headline: 'The Hot Towel Experience', description: 'Every visit includes a signature hot towel treatment — relax, refresh, and walk out looking your best.' },
          { headline: 'Your Neighborhood Barber', description: 'Serving Lake Hiawatha and Morris County since day one. Where regulars become family.' },
        ],
        hero_slogans: ['Where Every Cut Tells Your Story', 'Classic Barbering, Modern Gentleman'],
      },
      social: { social_links: [] },
      images: {},
    },
    assetUrls: [],
  },
  {
    slug: 'cravath-v2',
    siteId: 'cat-legal-001',
    businessName: 'Cravath, Swaine & Moore LLP',
    businessWebsite: 'https://www.cravath.com',
    additionalContext: 'One of the most prestigious law firms in the world. Pioneer of the "Cravath System" of associate development. Known for corporate law, M&A, and litigation. Founded 1819.',
    researchData: {
      profile: {
        business_type: 'Legal / Law Firm',
        business_name: 'Cravath, Swaine & Moore LLP',
        description: 'A premier international law firm renowned for its commitment to excellence and innovation in corporate law, litigation, and tax practice.',
        established_year: 1819,
        address: '825 Eighth Avenue, New York, NY 10019',
        phone: '(212) 474-1000',
        email: 'info@cravath.com',
        services: [
          { name: 'Corporate', description: 'M&A, securities, capital markets, banking, and finance transactions for Fortune 500 companies' },
          { name: 'Litigation', description: 'Complex commercial disputes, antitrust, securities litigation, and government investigations' },
          { name: 'Tax', description: 'Federal income tax planning for mergers, acquisitions, restructurings, and financial instruments' },
          { name: 'Executive Compensation', description: 'Executive employment agreements, equity-based compensation, and benefits programs' },
          { name: 'Trusts & Estates', description: 'Estate planning, trust administration, and philanthropic giving strategies' },
        ],
      },
      brand: {
        primary_color: '#1a2744',
        secondary_color: '#2c3e50',
        accent_color: '#c49a3c',
        heading_font: 'Merriweather',
        body_font: 'Source Sans Pro',
        style_notes: 'Authoritative, traditional, prestigious. Navy and gold. Clean, conservative layout.',
      },
      sellingPoints: {
        selling_points: [
          { headline: 'Over 200 Years of Excellence', description: 'Founded in 1819, Cravath is one of the oldest and most prestigious law firms in the United States.' },
          { headline: 'The Cravath System', description: 'Pioneered the model of hiring top law graduates, training them rigorously, and promoting from within.' },
          { headline: 'Landmark Transactions', description: 'Advising on the largest and most complex transactions in corporate history, including transformative M&A deals.' },
        ],
        hero_slogans: ['Excellence Since 1819', 'Where Law Meets Legacy'],
      },
      social: {
        website_url: 'https://www.cravath.com',
        social_links: [{ platform: 'LinkedIn', url: 'https://linkedin.com/company/cravath-swaine-&-moore-llp' }],
      },
      images: {},
    },
    assetUrls: [],
  },
  {
    slug: 'mayo-clinic-v2',
    siteId: 'cat-medical-001',
    businessName: 'Mayo Clinic',
    businessWebsite: 'https://www.mayoclinic.org',
    additionalContext: 'World-renowned nonprofit medical center. #1 hospital in the US (US News). Integrated multispecialty group practice. Three campuses: Rochester MN, Phoenix AZ, Jacksonville FL.',
    researchData: {
      profile: {
        business_type: 'Medical / Healthcare',
        business_name: 'Mayo Clinic',
        description: 'A nonprofit American academic medical center focused on integrated health care, education, and research. Consistently ranked as one of the best hospitals in the world.',
        established_year: 1889,
        address: '200 First St. SW, Rochester, MN 55905',
        phone: '(507) 284-2511',
        email: 'info@mayoclinic.org',
        services: [
          { name: 'Primary Care', description: 'Comprehensive primary care with a team-based approach' },
          { name: 'Cancer Center', description: 'Comprehensive cancer center with cutting-edge treatments and clinical trials' },
          { name: 'Heart & Vascular', description: 'Cardiovascular care including surgery, interventional cardiology, and transplant' },
          { name: 'Neurology & Neurosurgery', description: 'Brain and nervous system disorders, from epilepsy to brain tumors' },
          { name: 'Orthopedics', description: 'Joint replacement, spine surgery, sports medicine, and rehabilitation' },
          { name: 'Research & Education', description: 'Over 3,000 research projects and graduate medical education programs' },
        ],
      },
      brand: {
        primary_color: '#0057b8',
        secondary_color: '#003366',
        accent_color: '#00a3e0',
        heading_font: 'Poppins',
        body_font: 'Open Sans',
        style_notes: 'Clean, calming, trustworthy. Blue palette with white space. Modern healthcare feel.',
      },
      sellingPoints: {
        selling_points: [
          { headline: '#1 Hospital in America', description: 'Ranked #1 by US News & World Report more times than any other hospital.' },
          { headline: 'Team-Based Medicine', description: 'Pioneered the integrated group practice model where specialists collaborate for every patient.' },
          { headline: '4.7 Million Patient Visits Per Year', description: 'Serving patients from all 50 states and nearly 140 countries annually.' },
        ],
        hero_slogans: ['The Needs of the Patient Come First', 'World-Class Care, Close to Home'],
      },
      social: {
        website_url: 'https://www.mayoclinic.org',
        social_links: [
          { platform: 'Twitter', url: 'https://twitter.com/MayoClinic' },
          { platform: 'Facebook', url: 'https://facebook.com/MayoClinic' },
          { platform: 'YouTube', url: 'https://youtube.com/mayoclinic' },
        ],
      },
      images: {},
    },
    assetUrls: [],
  },
  {
    slug: 'linear-v2',
    siteId: 'cat-tech-001',
    businessName: 'Linear',
    businessWebsite: 'https://linear.app',
    additionalContext: 'Modern project management tool for software teams. Known for speed, keyboard-first design, and beautiful UI. YC-backed startup. Used by Vercel, Ramp, Cash App, and other top companies.',
    researchData: {
      profile: {
        business_type: 'Technology / SaaS',
        business_name: 'Linear',
        description: 'The issue tracking tool you will enjoy using. Linear is a modern project management tool built for speed, with keyboard shortcuts, real-time sync, and a beautiful interface.',
        established_year: 2019,
        address: 'San Francisco, CA',
        email: 'hello@linear.app',
        services: [
          { name: 'Issue Tracking', description: 'Lightning-fast issue tracking with keyboard-first design and real-time sync' },
          { name: 'Project Management', description: 'Roadmaps, cycles, and project views for planning and shipping' },
          { name: 'Workflows', description: 'Customizable workflows with automations and integrations' },
          { name: 'Insights', description: 'Analytics and reporting on team velocity and project health' },
          { name: 'Integrations', description: 'GitHub, Slack, Figma, Sentry, and 50+ other tools' },
        ],
      },
      brand: {
        primary_color: '#5e6ad2',
        secondary_color: '#1d1d2e',
        accent_color: '#58a6ff',
        heading_font: 'Inter',
        body_font: 'Inter',
        style_notes: 'Dark, minimal, futuristic. Purple-blue gradients. Glassmorphism. Terminal aesthetic.',
      },
      sellingPoints: {
        selling_points: [
          { headline: 'Built for Speed', description: '50ms interactions. Optimistic updates. The fastest project management tool ever built.' },
          { headline: 'Keyboard-First', description: 'Every action has a keyboard shortcut. Power users ship 3x faster with Linear.' },
          { headline: 'Loved by Top Teams', description: 'Used by Vercel, Ramp, Cash App, Retool, and thousands of high-performing engineering teams.' },
        ],
        hero_slogans: ['Linear is a better way to build software', 'The issue tracking tool you\'ll enjoy using'],
      },
      social: {
        website_url: 'https://linear.app',
        social_links: [
          { platform: 'Twitter', url: 'https://twitter.com/linear' },
          { platform: 'GitHub', url: 'https://github.com/linear' },
        ],
      },
      images: {},
    },
    assetUrls: [],
  },
  {
    slug: 'equinox-v2',
    siteId: 'cat-fitness-001',
    businessName: 'Equinox',
    businessWebsite: 'https://www.equinox.com',
    additionalContext: 'Luxury fitness club chain. Known for premium facilities, top trainers, and aspirational brand. The gold standard in fitness.',
    researchData: {
      profile: {
        business_type: 'Fitness / Gym',
        business_name: 'Equinox',
        description: 'The luxury fitness club that redefined the industry. Premium training, state-of-the-art facilities, and an uncompromising commitment to excellence.',
        established_year: 1991,
        address: 'Multiple Locations Worldwide',
        phone: '(866) 332-6549',
        email: 'info@equinox.com',
        services: [
          { name: 'Personal Training', description: 'Elite Tier X trainers with advanced certifications and personalized programs' },
          { name: 'Group Fitness', description: '100+ weekly classes: cycling, yoga, Pilates, HIIT, boxing, barre' },
          { name: 'The Spa', description: 'Full-service spa with massage, facials, and recovery treatments' },
          { name: 'Pool & Aquatics', description: 'Olympic-style pools with lap swimming and aqua classes' },
          { name: 'Equinox+', description: 'Digital platform with on-demand and live virtual classes' },
        ],
      },
      brand: {
        primary_color: '#000000',
        secondary_color: '#1a1a1a',
        accent_color: '#c41230',
        heading_font: 'Bebas Neue',
        body_font: 'Helvetica Neue',
        style_notes: 'Bold, aggressive, luxury. Black with red accents. High contrast. Motivational.',
      },
      sellingPoints: {
        selling_points: [
          { headline: "It's Not Fitness, It's Life", description: 'Equinox is more than a gym — it\'s a high-performance lifestyle brand.' },
          { headline: 'Elite Tier X Training', description: 'The most credentialed personal trainers in the industry, delivering transformative results.' },
          { headline: '100+ Clubs Worldwide', description: 'Luxury facilities in the world\'s most iconic neighborhoods.' },
        ],
        hero_slogans: ["It's Not Fitness. It's Life.", 'Commit to Something'],
      },
      social: {
        website_url: 'https://www.equinox.com',
        social_links: [
          { platform: 'Instagram', url: 'https://instagram.com/equinox' },
          { platform: 'Twitter', url: 'https://twitter.com/equinox' },
          { platform: 'YouTube', url: 'https://youtube.com/equinox' },
        ],
      },
      images: {},
    },
    assetUrls: [],
  },
  {
    slug: 'compass-v2',
    siteId: 'cat-realestate-001',
    businessName: 'Compass',
    businessWebsite: 'https://www.compass.com',
    additionalContext: 'Technology-driven real estate company. One of the largest real estate brokerages in the US. Known for their tech platform and agent tools.',
    researchData: {
      profile: {
        business_type: 'Real Estate',
        business_name: 'Compass',
        description: 'A technology-driven real estate company on a mission to help everyone find their place in the world. The largest independent real estate brokerage in the United States.',
        established_year: 2012,
        address: '110 Fifth Avenue, New York, NY 10011',
        phone: '(888) 966-8588',
        email: 'support@compass.com',
        services: [
          { name: 'Buy', description: 'Find your dream home with AI-powered search and expert agents' },
          { name: 'Sell', description: 'Sell your property faster with Compass Concierge, data-driven pricing, and targeted marketing' },
          { name: 'Rent', description: 'Browse exclusive rental listings across top markets' },
          { name: 'Compass Concierge', description: 'Front the cost of home improvements to sell faster and for more' },
          { name: 'Market Reports', description: 'Neighborhood insights and real estate market analytics' },
        ],
      },
      brand: {
        primary_color: '#1a1a2e',
        secondary_color: '#4a4a4a',
        accent_color: '#e7a737',
        heading_font: 'Libre Baskerville',
        body_font: 'Nunito Sans',
        style_notes: 'Elegant, upscale. Dark navy with gold accents. Premium real estate feel.',
      },
      sellingPoints: {
        selling_points: [
          { headline: 'Technology Meets Real Estate', description: 'Proprietary platform with AI-powered search, virtual tours, and data-driven insights.' },
          { headline: '28,000+ Top Agents', description: 'The best agents in the industry, backed by world-class technology and support.' },
          { headline: 'Compass Concierge', description: 'The only brokerage that fronts the cost of home improvements to sell faster and for more.' },
        ],
        hero_slogans: ['Find Your Place in the World', 'Real Estate, Reimagined'],
      },
      social: {
        website_url: 'https://www.compass.com',
        social_links: [
          { platform: 'Instagram', url: 'https://instagram.com/compass' },
          { platform: 'Twitter', url: 'https://twitter.com/compass' },
          { platform: 'LinkedIn', url: 'https://linkedin.com/company/compass' },
        ],
      },
      images: {},
    },
    assetUrls: [],
  },
  {
    slug: 'suffolk-v2',
    siteId: 'cat-construction-001',
    businessName: 'Suffolk Construction',
    businessWebsite: 'https://www.suffolk.com',
    additionalContext: 'One of the largest general building contractors in the US. Known for innovative technology and complex projects. $5B+ annual revenue.',
    researchData: {
      profile: {
        business_type: 'Construction / Home Services',
        business_name: 'Suffolk Construction',
        description: 'A national construction enterprise that builds, innovates, and invests. One of the largest and most innovative builders in the United States.',
        established_year: 1982,
        address: '65 Allerton Street, Boston, MA 02119',
        phone: '(617) 445-3500',
        email: 'info@suffolk.com',
        services: [
          { name: 'General Contracting', description: 'Full-service general contracting for complex commercial projects' },
          { name: 'Construction Management', description: 'Expert oversight from pre-construction through completion' },
          { name: 'Design-Build', description: 'Integrated design and construction delivery' },
          { name: 'Self-Perform', description: 'In-house concrete, carpentry, and specialty trade capabilities' },
          { name: 'Technology & Innovation', description: 'Suffolk Technologies — venture arm investing in construction tech' },
        ],
      },
      brand: {
        primary_color: '#003057',
        secondary_color: '#1a1a1a',
        accent_color: '#f7931e',
        heading_font: 'Roboto Slab',
        body_font: 'Roboto',
        style_notes: 'Bold, industrial, trustworthy. Navy with orange accents. Strong typography.',
      },
      sellingPoints: {
        selling_points: [
          { headline: '$5B+ Annual Revenue', description: 'One of the largest private construction companies in the US, building landmark projects coast to coast.' },
          { headline: 'Technology-Driven Builder', description: 'Suffolk Technologies invests in and develops cutting-edge construction technology solutions.' },
          { headline: '40+ Years of Excellence', description: 'From Boston to Miami to Los Angeles — building America\'s most iconic projects since 1982.' },
        ],
        hero_slogans: ['Build Smart. Build Suffolk.', 'Building What\'s Next'],
      },
      social: {
        website_url: 'https://www.suffolk.com',
        social_links: [
          { platform: 'LinkedIn', url: 'https://linkedin.com/company/suffolk-construction' },
          { platform: 'Instagram', url: 'https://instagram.com/suffolkconstruction' },
        ],
      },
      images: {},
    },
    assetUrls: [],
  },
  {
    slug: 'annie-leibovitz-v2',
    siteId: 'cat-photo-001',
    businessName: 'Annie Leibovitz Studio',
    businessWebsite: '',
    additionalContext: 'Legendary portrait photographer. Known for iconic celebrity and editorial portraits. Former chief photographer for Rolling Stone and Vanity Fair. Shot the last photo of John Lennon.',
    researchData: {
      profile: {
        business_type: 'Photography / Creative',
        business_name: 'Annie Leibovitz Studio',
        description: 'The studio of Annie Leibovitz, one of the most celebrated portrait photographers of our time. Known for dramatic, richly detailed, and intimate portraits.',
        established_year: 1970,
        address: 'New York, NY',
        email: 'studio@annieleibovitz.com',
        services: [
          { name: 'Editorial Photography', description: 'Magazine covers and editorial spreads for Vanity Fair, Vogue, and other major publications' },
          { name: 'Portraiture', description: 'Intimate and iconic portrait sessions for individuals and families' },
          { name: 'Commercial & Advertising', description: 'Campaign imagery for luxury brands and cultural institutions' },
          { name: 'Fine Art', description: 'Limited edition prints and gallery exhibitions' },
          { name: 'Books & Publications', description: 'Monographs and retrospectives of a legendary career' },
        ],
      },
      brand: {
        primary_color: '#1a1a1a',
        secondary_color: '#333333',
        accent_color: '#e8e8e8',
        heading_font: 'DM Sans',
        body_font: 'DM Sans',
        style_notes: 'Minimal, gallery aesthetic. Black and white with subtle accents. The work speaks for itself.',
      },
      sellingPoints: {
        selling_points: [
          { headline: '50+ Years of Iconic Imagery', description: 'From John Lennon\'s final portrait to the Obama White House — images that define our cultural memory.' },
          { headline: 'Rolling Stone to Vanity Fair', description: 'Chief photographer at Rolling Stone (1973-1983) then Vanity Fair and Vogue — the most influential editorial career in photography.' },
          { headline: 'Fine Art & Collections', description: 'Work exhibited at the Smithsonian, Brooklyn Museum, and galleries worldwide. Limited edition prints highly sought by collectors.' },
        ],
        hero_slogans: ['Seeing Through the Lens of Time', 'Portraits That Define a Generation'],
      },
      social: {
        social_links: [
          { platform: 'Instagram', url: 'https://instagram.com/annieleibovitz' },
        ],
      },
      images: {},
    },
    assetUrls: [],
  },
  {
    slug: 'the-white-house-v4',
    siteId: 'cat-other-001',
    businessName: 'The White House',
    businessWebsite: 'https://www.whitehouse.gov',
    additionalContext: 'The official residence and workplace of the President of the United States. 1600 Pennsylvania Avenue. Built 1792-1800. 132 rooms, 35 bathrooms, 6 levels.',
    researchData: {
      profile: {
        business_type: 'Other',
        business_name: 'The White House',
        description: 'The official residence and workplace of the President of the United States, located at 1600 Pennsylvania Avenue NW in Washington, D.C. A symbol of American democracy.',
        established_year: 1800,
        address: '1600 Pennsylvania Avenue NW, Washington, DC 20500',
        phone: '(202) 456-1111',
        email: 'president@whitehouse.gov',
        services: [
          { name: 'Public Tours', description: 'Free self-guided tours of the East Wing and select State Floor rooms' },
          { name: 'State Events', description: 'State Dinners, ceremonies, and official White House events' },
          { name: 'Visitor Center', description: 'White House Visitor Center with exhibits, history, and gift shop' },
          { name: 'Educational Programs', description: 'Educational resources and civic engagement programs' },
        ],
        hours: [
          { day: 'Tuesday', open: '7:30 AM', close: '11:30 AM' },
          { day: 'Wednesday', open: '7:30 AM', close: '11:30 AM' },
          { day: 'Thursday', open: '7:30 AM', close: '1:30 PM' },
          { day: 'Friday', open: '7:30 AM', close: '1:30 PM' },
          { day: 'Saturday', open: '7:30 AM', close: '1:30 PM' },
        ],
      },
      brand: {
        primary_color: '#002868',
        secondary_color: '#1a2744',
        accent_color: '#BF0A30',
        heading_font: 'Merriweather',
        body_font: 'Source Sans Pro',
        style_notes: 'Patriotic, dignified, authoritative. Red, white, and blue. Presidential.',
      },
      sellingPoints: {
        selling_points: [
          { headline: "America's House", description: 'Home to every US President since John Adams in 1800. 132 rooms, 35 bathrooms, 6 levels, 412 doors.' },
          { headline: 'A Living Museum', description: 'Contains the finest collection of American art, furniture, and decorative arts spanning 200+ years.' },
          { headline: 'Symbol of Democracy', description: 'The most iconic address in the world — where the work of American governance happens every day.' },
        ],
        hero_slogans: ["The People's House", 'Where Democracy Lives'],
      },
      social: {
        website_url: 'https://www.whitehouse.gov',
        social_links: [
          { platform: 'Twitter', url: 'https://twitter.com/WhiteHouse' },
          { platform: 'Instagram', url: 'https://instagram.com/whitehouse' },
          { platform: 'Facebook', url: 'https://facebook.com/WhiteHouse' },
          { platform: 'YouTube', url: 'https://youtube.com/whitehouse' },
        ],
      },
      images: {},
    },
    assetUrls: [],
  },
];

async function runBuild(build, index) {
  console.log(`\n[${ index + 1}/${BUILDS.length}] Starting: ${build.businessName} (${build.slug})`);
  console.log(`   Category: ${build.researchData.profile.business_type}`);

  try {
    const res = await fetch(AGENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(build),
    });
    const data = await res.json();
    console.log(`   → Dispatched: ${JSON.stringify(data)}`);
    return data;
  } catch (err) {
    console.error(`   → FAILED: ${err.message}`);
    return null;
  }
}

// Run builds sequentially
async function main() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Running ${BUILDS.length} category builds`);
  console.log(`${'═'.repeat(60)}\n`);

  // Run one at a time (each takes ~5-10 minutes with Claude Code)
  for (let i = 0; i < BUILDS.length; i++) {
    await runBuild(BUILDS[i], i);
    // Wait 5 seconds between dispatches to let the agent start
    if (i < BUILDS.length - 1) {
      console.log(`   Waiting 5s before next build...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`All ${BUILDS.length} builds dispatched!`);
  console.log(`Monitor progress in the local agent terminal.`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(console.error);
