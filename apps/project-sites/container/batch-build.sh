#!/bin/bash
# Batch build all remaining categories through the local agent
# Usage: ./batch-build.sh

set -a && source /Users/apple/emdash-projects/worktrees/rare-chefs-film-8op/.env.local && set +a
cd /Users/apple/emdash-projects/worktrees/rare-chefs-film-8op/apps/project-sites/container

AGENT_URL="http://localhost:4400/build"

dispatch_and_wait() {
  local slug="$1"
  local payload="$2"
  local site_id="$3"

  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "DISPATCHING: $slug"
  echo "═══════════════════════════════════════════════════════"

  # Dispatch
  curl -s -X POST "$AGENT_URL" -H 'Content-Type: application/json' -d "$payload"
  echo ""

  # Wait for build to complete (check for dist/ directory)
  local build_dir
  local waited=0
  while true; do
    sleep 30
    waited=$((waited + 30))
    build_dir=$(ls -d /tmp/claude-build-${slug}-* 2>/dev/null | tail -1)
    if [ -n "$build_dir" ] && [ -f "$build_dir/dist/index.html" ]; then
      # Check if Claude Code is still running
      if ! pgrep -f "claude.*-p$" > /dev/null 2>&1; then
        echo "  Build complete after ${waited}s: $build_dir"
        break
      fi
    fi
    if [ $waited -ge 900 ]; then
      echo "  TIMEOUT after ${waited}s — skipping"
      return 1
    fi
    echo "  Waiting... (${waited}s)"
  done

  # Upload
  echo "  Uploading..."
  node upload-build.mjs "$build_dir" "$slug" "$site_id"
  echo "  ✅ https://${slug}.projectsites.dev"
  echo ""
}

# Cravath (Legal)
dispatch_and_wait "cravath-v2" '{
  "slug": "cravath-v2", "siteId": "cat-legal-001", "businessName": "Cravath, Swaine & Moore LLP",
  "businessWebsite": "https://www.cravath.com",
  "additionalContext": "One of the most prestigious law firms in the world. Pioneer of the Cravath System. Founded 1819. Known for M&A, corporate law, litigation.",
  "researchData": {"profile": {"business_type": "Legal / Law Firm", "business_name": "Cravath, Swaine & Moore LLP", "description": "Premier international law firm.", "established_year": 1819, "address": "825 Eighth Avenue, New York, NY 10019", "phone": "(212) 474-1000", "email": "info@cravath.com", "services": [{"name": "Corporate", "description": "M&A, securities, capital markets"}, {"name": "Litigation", "description": "Complex commercial disputes, antitrust"}, {"name": "Tax", "description": "Federal income tax planning"}, {"name": "Executive Compensation", "description": "Employment agreements, equity compensation"}, {"name": "Trusts & Estates", "description": "Estate planning and philanthropy"}]}, "brand": {"primary_color": "#1a2744", "secondary_color": "#2c3e50", "accent_color": "#c49a3c", "heading_font": "Merriweather", "body_font": "Source Sans Pro", "style_notes": "Authoritative, traditional, prestigious. Navy and gold."}, "sellingPoints": {"selling_points": [{"headline": "Over 200 Years of Excellence", "description": "Founded in 1819, one of the oldest law firms in the US."}, {"headline": "The Cravath System", "description": "Pioneered hiring top law graduates and promoting from within."}, {"headline": "Landmark Transactions", "description": "Advising on the largest M&A deals in history."}], "hero_slogans": ["Excellence Since 1819", "Where Law Meets Legacy"]}, "social": {"website_url": "https://www.cravath.com", "social_links": [{"platform": "LinkedIn", "url": "https://linkedin.com/company/cravath"}]}, "images": {}},
  "assetUrls": []
}' "cat-legal-001"

# Mayo Clinic (Medical)
dispatch_and_wait "mayo-clinic-v2" '{
  "slug": "mayo-clinic-v2", "siteId": "cat-medical-001", "businessName": "Mayo Clinic",
  "businessWebsite": "https://www.mayoclinic.org",
  "additionalContext": "#1 hospital in the US. Nonprofit academic medical center. Three campuses. Founded 1889.",
  "researchData": {"profile": {"business_type": "Medical / Healthcare", "business_name": "Mayo Clinic", "description": "Nonprofit American academic medical center.", "established_year": 1889, "address": "200 First St. SW, Rochester, MN 55905", "phone": "(507) 284-2511", "email": "info@mayoclinic.org", "services": [{"name": "Primary Care", "description": "Comprehensive primary care"}, {"name": "Cancer Center", "description": "Cutting-edge cancer treatments"}, {"name": "Heart & Vascular", "description": "Cardiovascular care and transplant"}, {"name": "Neurology", "description": "Brain and nervous system disorders"}, {"name": "Orthopedics", "description": "Joint replacement, sports medicine"}, {"name": "Research", "description": "3000+ research projects"}]}, "brand": {"primary_color": "#0057b8", "secondary_color": "#003366", "accent_color": "#00a3e0", "heading_font": "Poppins", "body_font": "Open Sans", "style_notes": "Clean, calming, trustworthy. Blue palette."}, "sellingPoints": {"selling_points": [{"headline": "#1 Hospital in America", "description": "Ranked #1 by US News more times than any other."}, {"headline": "Team-Based Medicine", "description": "Pioneers of integrated group practice."}, {"headline": "4.7M Patient Visits/Year", "description": "Patients from all 50 states and 140 countries."}], "hero_slogans": ["The Needs of the Patient Come First", "World-Class Care"]}, "social": {"website_url": "https://www.mayoclinic.org", "social_links": [{"platform": "Twitter", "url": "https://twitter.com/MayoClinic"}, {"platform": "Facebook", "url": "https://facebook.com/MayoClinic"}]}, "images": {}},
  "assetUrls": []
}' "cat-medical-001"

# Linear (Tech)
dispatch_and_wait "linear-v2" '{
  "slug": "linear-v2", "siteId": "cat-tech-001", "businessName": "Linear",
  "businessWebsite": "https://linear.app",
  "additionalContext": "Modern issue tracker for software teams. Known for speed, keyboard-first design, beautiful UI.",
  "researchData": {"profile": {"business_type": "Technology / SaaS", "business_name": "Linear", "description": "The issue tracking tool you will enjoy using.", "established_year": 2019, "address": "San Francisco, CA", "email": "hello@linear.app", "services": [{"name": "Issue Tracking", "description": "Lightning-fast with keyboard-first design"}, {"name": "Project Management", "description": "Roadmaps, cycles, project views"}, {"name": "Workflows", "description": "Customizable automations"}, {"name": "Insights", "description": "Team velocity and project health analytics"}, {"name": "Integrations", "description": "GitHub, Slack, Figma, 50+ tools"}]}, "brand": {"primary_color": "#5e6ad2", "secondary_color": "#1d1d2e", "accent_color": "#58a6ff", "heading_font": "Inter", "body_font": "Inter", "style_notes": "Dark, minimal, futuristic. Purple-blue gradients. Glassmorphism."}, "sellingPoints": {"selling_points": [{"headline": "Built for Speed", "description": "50ms interactions. The fastest project management tool."}, {"headline": "Keyboard-First", "description": "Every action has a keyboard shortcut."}, {"headline": "Loved by Top Teams", "description": "Used by Vercel, Ramp, Cash App."}], "hero_slogans": ["Linear is a better way to build software", "The issue tracking tool you will enjoy using"]}, "social": {"website_url": "https://linear.app", "social_links": [{"platform": "Twitter", "url": "https://twitter.com/linear"}, {"platform": "GitHub", "url": "https://github.com/linear"}]}, "images": {}},
  "assetUrls": []
}' "cat-tech-001"

# Equinox (Fitness)
dispatch_and_wait "equinox-v2" '{
  "slug": "equinox-v2", "siteId": "cat-fitness-001", "businessName": "Equinox",
  "businessWebsite": "https://www.equinox.com",
  "additionalContext": "Luxury fitness club chain. Premium facilities, top trainers, aspirational brand.",
  "researchData": {"profile": {"business_type": "Fitness / Gym", "business_name": "Equinox", "description": "The luxury fitness club that redefined the industry.", "established_year": 1991, "address": "Multiple Locations Worldwide", "phone": "(866) 332-6549", "email": "info@equinox.com", "services": [{"name": "Personal Training", "description": "Elite Tier X trainers"}, {"name": "Group Fitness", "description": "100+ weekly classes"}, {"name": "The Spa", "description": "Full-service spa"}, {"name": "Pool & Aquatics", "description": "Olympic pools"}, {"name": "Equinox+", "description": "Digital platform"}]}, "brand": {"primary_color": "#000000", "secondary_color": "#1a1a1a", "accent_color": "#c41230", "heading_font": "Bebas Neue", "body_font": "Helvetica Neue", "style_notes": "Bold, aggressive, luxury. Black with red accents."}, "sellingPoints": {"selling_points": [{"headline": "Its Not Fitness, Its Life", "description": "More than a gym — a high-performance lifestyle brand."}, {"headline": "Elite Tier X Training", "description": "The most credentialed trainers in the industry."}, {"headline": "100+ Clubs Worldwide", "description": "Luxury facilities in iconic neighborhoods."}], "hero_slogans": ["Its Not Fitness. Its Life.", "Commit to Something"]}, "social": {"website_url": "https://www.equinox.com", "social_links": [{"platform": "Instagram", "url": "https://instagram.com/equinox"}, {"platform": "Twitter", "url": "https://twitter.com/equinox"}]}, "images": {}},
  "assetUrls": []
}' "cat-fitness-001"

# Compass (Real Estate)
dispatch_and_wait "compass-v2" '{
  "slug": "compass-v2", "siteId": "cat-realestate-001", "businessName": "Compass",
  "businessWebsite": "https://www.compass.com",
  "additionalContext": "Technology-driven real estate company. Largest independent brokerage in the US.",
  "researchData": {"profile": {"business_type": "Real Estate", "business_name": "Compass", "description": "A technology-driven real estate company.", "established_year": 2012, "address": "110 Fifth Avenue, New York, NY 10011", "phone": "(888) 966-8588", "email": "support@compass.com", "services": [{"name": "Buy", "description": "AI-powered home search"}, {"name": "Sell", "description": "Compass Concierge"}, {"name": "Rent", "description": "Exclusive rental listings"}, {"name": "Market Reports", "description": "Neighborhood insights"}]}, "brand": {"primary_color": "#1a1a2e", "secondary_color": "#4a4a4a", "accent_color": "#e7a737", "heading_font": "Libre Baskerville", "body_font": "Nunito Sans", "style_notes": "Elegant, upscale. Dark navy with gold."}, "sellingPoints": {"selling_points": [{"headline": "Technology Meets Real Estate", "description": "Proprietary AI-powered platform."}, {"headline": "28000+ Top Agents", "description": "Best agents backed by world-class tech."}, {"headline": "Compass Concierge", "description": "Fronts cost of home improvements."}], "hero_slogans": ["Find Your Place in the World", "Real Estate Reimagined"]}, "social": {"website_url": "https://www.compass.com", "social_links": [{"platform": "Instagram", "url": "https://instagram.com/compass"}, {"platform": "LinkedIn", "url": "https://linkedin.com/company/compass"}]}, "images": {}},
  "assetUrls": []
}' "cat-realestate-001"

# Suffolk (Construction)
dispatch_and_wait "suffolk-v2" '{
  "slug": "suffolk-v2", "siteId": "cat-construction-001", "businessName": "Suffolk Construction",
  "businessWebsite": "https://www.suffolk.com",
  "additionalContext": "One of the largest general building contractors in the US. $5B+ annual revenue. Innovative technology.",
  "researchData": {"profile": {"business_type": "Construction / Home Services", "business_name": "Suffolk Construction", "description": "National construction enterprise.", "established_year": 1982, "address": "65 Allerton Street, Boston, MA 02119", "phone": "(617) 445-3500", "email": "info@suffolk.com", "services": [{"name": "General Contracting", "description": "Full-service commercial"}, {"name": "Construction Management", "description": "Pre-construction through completion"}, {"name": "Design-Build", "description": "Integrated delivery"}, {"name": "Self-Perform", "description": "In-house concrete, carpentry"}, {"name": "Suffolk Technologies", "description": "Venture arm"}]}, "brand": {"primary_color": "#003057", "secondary_color": "#1a1a1a", "accent_color": "#f7931e", "heading_font": "Roboto Slab", "body_font": "Roboto", "style_notes": "Bold, industrial. Navy with orange."}, "sellingPoints": {"selling_points": [{"headline": "$5B+ Annual Revenue", "description": "One of the largest private construction companies."}, {"headline": "Technology-Driven Builder", "description": "Suffolk Technologies invests in construction tech."}, {"headline": "40+ Years of Excellence", "description": "Building iconic projects since 1982."}], "hero_slogans": ["Build Smart. Build Suffolk.", "Building Whats Next"]}, "social": {"website_url": "https://www.suffolk.com", "social_links": [{"platform": "LinkedIn", "url": "https://linkedin.com/company/suffolk-construction"}]}, "images": {}},
  "assetUrls": []
}' "cat-construction-001"

# Annie Leibovitz (Photography)
dispatch_and_wait "annie-leibovitz-v2" '{
  "slug": "annie-leibovitz-v2", "siteId": "cat-photo-001", "businessName": "Annie Leibovitz Studio",
  "businessWebsite": "",
  "additionalContext": "Legendary portrait photographer. Rolling Stone, Vanity Fair. Last photo of John Lennon.",
  "researchData": {"profile": {"business_type": "Photography / Creative", "business_name": "Annie Leibovitz Studio", "description": "One of the most celebrated portrait photographers of our time.", "established_year": 1970, "address": "New York, NY", "email": "studio@annieleibovitz.com", "services": [{"name": "Editorial Photography", "description": "Magazine covers for Vanity Fair, Vogue"}, {"name": "Portraiture", "description": "Intimate iconic portrait sessions"}, {"name": "Commercial", "description": "Campaign imagery for luxury brands"}, {"name": "Fine Art", "description": "Limited edition prints and exhibitions"}, {"name": "Books", "description": "Monographs and retrospectives"}]}, "brand": {"primary_color": "#1a1a1a", "secondary_color": "#333333", "accent_color": "#e8e8e8", "heading_font": "DM Sans", "body_font": "DM Sans", "style_notes": "Minimal gallery aesthetic. Black and white. The work speaks for itself."}, "sellingPoints": {"selling_points": [{"headline": "50+ Years of Iconic Imagery", "description": "From John Lennons final portrait to the Obama White House."}, {"headline": "Rolling Stone to Vanity Fair", "description": "Chief photographer at both."}, {"headline": "Fine Art & Collections", "description": "Exhibited at Smithsonian, Brooklyn Museum."}], "hero_slogans": ["Seeing Through the Lens of Time", "Portraits That Define a Generation"]}, "social": {"social_links": [{"platform": "Instagram", "url": "https://instagram.com/annieleibovitz"}]}, "images": {}},
  "assetUrls": []
}' "cat-photo-001"

# White House (Other)
dispatch_and_wait "the-white-house-v4" '{
  "slug": "the-white-house-v4", "siteId": "cat-other-001", "businessName": "The White House",
  "businessWebsite": "https://www.whitehouse.gov",
  "additionalContext": "Official residence of the President. 1600 Pennsylvania Avenue. Built 1792-1800. 132 rooms, 35 bathrooms, 6 levels, 412 doors.",
  "researchData": {"profile": {"business_type": "Other", "business_name": "The White House", "description": "The official residence and workplace of the President of the United States.", "established_year": 1800, "address": "1600 Pennsylvania Avenue NW, Washington, DC 20500", "phone": "(202) 456-1111", "email": "president@whitehouse.gov", "services": [{"name": "Public Tours", "description": "Free self-guided tours"}, {"name": "State Events", "description": "State Dinners and ceremonies"}, {"name": "Visitor Center", "description": "Exhibits, history, gift shop"}, {"name": "Educational Programs", "description": "Civic engagement programs"}], "hours": [{"day": "Tue-Wed", "open": "7:30 AM", "close": "11:30 AM"}, {"day": "Thu-Sat", "open": "7:30 AM", "close": "1:30 PM"}]}, "brand": {"primary_color": "#002868", "secondary_color": "#1a2744", "accent_color": "#BF0A30", "heading_font": "Merriweather", "body_font": "Source Sans Pro", "style_notes": "Patriotic, dignified, authoritative. Red, white, blue."}, "sellingPoints": {"selling_points": [{"headline": "Americas House", "description": "Home to every US President since 1800. 132 rooms, 35 bathrooms."}, {"headline": "A Living Museum", "description": "Finest collection of American art spanning 200+ years."}, {"headline": "Symbol of Democracy", "description": "The most iconic address in the world."}], "hero_slogans": ["The Peoples House", "Where Democracy Lives"]}, "social": {"website_url": "https://www.whitehouse.gov", "social_links": [{"platform": "Twitter", "url": "https://twitter.com/WhiteHouse"}, {"platform": "Instagram", "url": "https://instagram.com/whitehouse"}]}, "images": {}},
  "assetUrls": []
}' "cat-other-001"

echo ""
echo "══════════════════════════════════���════════════════════"
echo "ALL BUILDS COMPLETE"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Live sites:"
echo "  https://cravath-v2.projectsites.dev"
echo "  https://mayo-clinic-v2.projectsites.dev"
echo "  https://linear-v2.projectsites.dev"
echo "  https://equinox-v2.projectsites.dev"
echo "  https://compass-v2.projectsites.dev"
echo "  https://suffolk-v2.projectsites.dev"
echo "  https://annie-leibovitz-v2.projectsites.dev"
echo "  https://the-white-house-v4.projectsites.dev"
