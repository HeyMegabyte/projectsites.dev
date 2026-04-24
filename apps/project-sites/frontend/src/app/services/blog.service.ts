import { Injectable } from '@angular/core';

/**
 * Blog post data model.
 *
 * @remarks
 * Represents a single blog article with markdown content, metadata,
 * and SEO-relevant fields (slug, excerpt, category).
 */
export interface BlogPost {
  readonly slug: string;
  readonly title: string;
  readonly excerpt: string;
  readonly content: string;
  readonly date: string;
  readonly readingTime: string;
  readonly category: string;
  readonly author: string;
}

const POSTS: readonly BlogPost[] = [
  {
    slug: '5-reasons-your-small-business-needs-a-professional-website',
    title: '5 Reasons Your Small Business Needs a Professional Website in 2025',
    excerpt: 'Your website is your hardest-working employee. It sells, builds trust, and brings in leads around the clock.',
    date: 'April 15, 2025',
    readingTime: '4 min read',
    category: 'Business Growth',
    author: 'Brian Zalewski',
    content: `## Your Website Works While You Sleep

Every small business owner knows the grind. You open at 7 AM, close at 9 PM, and still feel like there aren't enough hours. But a professional website? It never clocks out. It sells, answers questions, and builds trust 24 hours a day, 365 days a year.

Here are five reasons a professional website isn't optional anymore — it's your competitive edge.

## 1. Mobile Traffic Now Dominates

Over 60% of all web traffic comes from mobile devices. If your business doesn't have a fast, mobile-optimized website, you're invisible to the majority of potential customers. They're searching for businesses like yours on their phones right now — while commuting, waiting in line, or sitting on the couch.

A professional website adapts to every screen size. It loads in under 2 seconds. It makes your phone number tappable and your address clickable. Without it, customers bounce to your competitor who does have one.

## 2. SEO Brings Free, Targeted Traffic

Search engine optimization is the gift that keeps giving. When someone searches "plumber near me" or "best bakery in Brooklyn," Google decides who shows up. A professionally built website with proper meta tags, schema markup, local keywords, and fast load times ranks higher.

That means free traffic from people actively looking for what you sell. No ad spend required. But you need a real website — not a Facebook page or a listing on Yelp — to capture those searches.

## 3. Credibility Is Non-Negotiable

According to Stanford research, 75% of users judge a company's credibility based on its website design. A polished, professional site tells visitors: "This business is legitimate, successful, and cares about quality."

A dated site — or worse, no site at all — sends the opposite message. Potential customers assume you're either too small, too new, or too careless. First impressions happen in 50 milliseconds. Make them count.

## 4. Conversions Depend on Experience

A professional website isn't just pretty. It's engineered to convert visitors into customers. Clear calls-to-action, intuitive navigation, fast forms, and trust signals (reviews, certifications, guarantees) all drive conversions.

The difference between a DIY site and a professionally designed one can be a 200-400% improvement in conversion rates. That's the difference between 2 leads per month and 10.

## 5. You Own Your Platform

Social media platforms change their algorithms constantly. Your Facebook reach dropped from 16% to under 2% in a decade. Instagram hides your posts behind paid promotion. TikTok could ban your account tomorrow.

Your website is the only digital property you truly own. Your content, your design, your rules. It's your home base — everything else is rented land.

## The Bottom Line

A professional website isn't an expense. It's an investment that pays for itself through increased visibility, credibility, and conversions. Every month without one is revenue left on the table.

Project Sites builds professional, AI-powered websites for small businesses in minutes — not weeks. No design skills needed. No monthly fees to get started.`,
  },
  {
    slug: 'how-ai-is-changing-web-design-for-small-businesses',
    title: 'How AI Is Changing Web Design for Small Businesses',
    excerpt: 'AI website builders cut costs by 90% and deliver in minutes. Here is what that means for your business.',
    date: 'April 8, 2025',
    readingTime: '3 min read',
    category: 'Technology',
    author: 'Brian Zalewski',
    content: `## The Old Way Was Broken

Traditional web design follows a painful pattern. You find a designer, pay $3,000-$10,000, wait 4-8 weeks, go through endless revision rounds, and end up with something that still doesn't quite match your vision. Then you pay monthly hosting fees, and every text change requires a support ticket.

For small businesses operating on thin margins, this model was always broken. Most just gave up and relied on social media instead.

## AI Changed Everything

Modern AI can analyze your business, research your industry, study your competitors, and generate a complete, professional website in under 15 minutes. Not a template with your name slapped on it — a genuinely custom site built around your specific business, location, and brand.

The technology behind this isn't magic. It's the same large language models powering ChatGPT and Claude, combined with computer vision, web scraping, and design systems trained on thousands of award-winning websites.

## Cost Savings Are Massive

The math is simple. Traditional web design: $5,000 average cost, 6-week timeline. AI-powered web design: under $50/month, delivered in minutes. That's a 90% cost reduction and a 99% time reduction.

For a small business owner, that means you can have a professional website live today — not next quarter. And you can update it yourself, instantly, without paying a developer.

## Quality Is Surprisingly High

Early AI-generated websites looked robotic and generic. That era is over. Today's AI builders produce sites that rival what a skilled designer creates. They use modern design systems, responsive layouts, accessibility best practices, and SEO optimization out of the box.

The secret is in the training data. AI models have studied millions of websites. They know what works — clean typography, intuitive navigation, compelling calls-to-action, and fast load times. They apply these principles automatically.

## Customization Without Compromise

AI doesn't mean cookie-cutter. The best AI builders extract your actual brand colors, use your real business photos, and write copy specific to your services and location. They generate unique layouts based on your industry — a restaurant site looks different from a law firm site.

You keep full control. Edit any text, swap any image, adjust colors, add pages. The AI gives you a professional starting point; you make it yours.

## What This Means for Your Business

If you've been putting off building a website because of cost, complexity, or time — those barriers are gone. AI-powered builders deliver professional results at a fraction of the cost, in a fraction of the time.

The businesses that adopt this technology first gain a real advantage. While competitors are still waiting on their designer's revision round, you're already ranking on Google and converting visitors into customers.`,
  },
  {
    slug: 'complete-guide-to-local-seo-for-small-business-websites',
    title: 'The Complete Guide to Local SEO for Small Business Websites',
    excerpt: 'Rank higher in local search results with these proven strategies. No marketing degree required.',
    date: 'March 28, 2025',
    readingTime: '5 min read',
    category: 'SEO',
    author: 'Brian Zalewski',
    content: `## Why Local SEO Matters More Than Ever

46% of all Google searches have local intent. When someone types "dentist near me" or "best pizza in Chicago," they're ready to buy. These aren't casual browsers — they're customers with wallets open, looking for a business like yours.

If your website doesn't show up in those results, you're handing customers directly to your competitors. Local SEO is how you fix that.

## Step 1: Claim and Optimize Your Google Business Profile

Your Google Business Profile (GBP) is the single most important factor in local search rankings. It's the box that appears in Google Maps and the "local pack" — the top 3 business results shown for local searches.

Here's what to do:

- **Claim your listing** at business.google.com if you haven't already
- **Fill out every field**: business name, address, phone, website, hours, categories, description
- **Add photos**: Businesses with 100+ photos get 520% more calls than average
- **Post updates weekly**: Google rewards active profiles with higher rankings
- **Respond to every review**: Both positive and negative, within 24 hours

The businesses that dominate local search treat their GBP like a second website. Update it constantly.

## Step 2: Nail Your Local Keywords

Generic keywords like "plumber" are impossible to rank for. Local keywords like "emergency plumber in Newark NJ" are achievable and more valuable — because the searcher is in your area and ready to hire.

Build your keyword strategy around this formula:

- **Primary keyword**: [service] + [city/neighborhood] (e.g., "hair salon in Hoboken")
- **Secondary keywords**: [specific service] + [location] (e.g., "balayage highlights Hoboken NJ")
- **Long-tail keywords**: [question] + [location] (e.g., "best place for haircut near Journal Square")

Place your primary keyword in: page title, meta description, H1 heading, first paragraph, at least two H2s, and image alt text. Keep it natural — never stuff keywords.

## Step 3: Keep NAP Consistent Everywhere

NAP stands for Name, Address, Phone number. Google cross-references your NAP across the entire internet to verify your business is legitimate and located where you say it is.

If your name is "Joe's Auto Shop" on your website but "Joseph's Automotive" on Yelp and "Joe's Auto Repair Shop" on Facebook, Google gets confused. Confused Google means lower rankings.

Audit every listing — Google, Yelp, Facebook, Apple Maps, Yellow Pages, BBB, industry directories. Make them all match exactly. Same business name. Same address format. Same phone number.

## Step 4: Get More Reviews (and Respond to All of Them)

Reviews are the second biggest factor in local rankings, behind only your Google Business Profile. Businesses with more reviews and higher ratings rank higher. Period.

How to get more reviews:

- **Ask every happy customer**: In person, via email follow-up, or with a printed card
- **Make it easy**: Create a direct link to your Google review page (search "Google review link generator")
- **Time it right**: Ask right after delivering a great experience, not days later
- **Never buy reviews**: Google penalizes fake reviews and can suspend your listing

Respond to every review — yes, even the negative ones. A thoughtful response to a bad review shows professionalism and often impresses potential customers more than five-star reviews.

## Step 5: Add Schema Markup to Your Website

Schema markup is code that tells Google exactly what your business is, where it's located, and what services you offer. It's like giving Google a structured cheat sheet about your business.

The most important schema types for local businesses:

- **LocalBusiness**: Name, address, phone, hours, geo coordinates, price range
- **FAQPage**: Turns your FAQ section into rich snippets in search results
- **BreadcrumbList**: Shows your site hierarchy in search results
- **Review/AggregateRating**: Displays star ratings in search results

If your website doesn't have schema markup, you're missing out on rich snippets — those enhanced search results with star ratings, hours, and prices that get significantly more clicks.

## Step 6: Build Local Backlinks

Backlinks from other local websites tell Google your business is trusted in the community. The best local backlink sources:

- **Local news sites**: Sponsor a community event and get covered
- **Chamber of Commerce**: Join and get listed on their member directory
- **Local blogs**: Reach out to local bloggers for features or partnerships
- **Business associations**: Industry-specific directories and organizations
- **Schools and nonprofits**: Sponsor or volunteer — they'll link to your site

Quality matters more than quantity. One link from your city's newspaper is worth more than 100 links from random directories.

## Step 7: Optimize for "Near Me" Searches

"Near me" searches have grown 500% in the last two years. Google uses the searcher's location to determine which businesses to show. To rank for these searches:

- **Include your full address** on every page (header or footer)
- **Embed a Google Map** on your contact page
- **Create location-specific content**: "Serving the [neighborhood] area since [year]"
- **Use local landmarks**: "Located two blocks from [well-known place]"
- **Add service area pages**: If you serve multiple neighborhoods, create a page for each

## The Bottom Line

Local SEO isn't complicated, but it requires consistency. The businesses that show up first in local search are the ones that claimed their Google profile, nailed their keywords, kept their information consistent, earned real reviews, and built their local presence over time.

Start with your Google Business Profile today. Add schema markup to your website this week. Ask your next happy customer for a review. Small, consistent actions compound into dominant local search rankings.

Project Sites automatically implements local SEO best practices — schema markup, meta tags, local keywords, and Google Maps integration — for every site we build.`,
  },
];

/**
 * Blog service providing access to hardcoded seed blog posts.
 *
 * @remarks
 * Serves as the data layer for the blog list and blog post pages.
 * Posts are stored as compile-time constants with markdown content.
 *
 * @example
 * ```typescript
 * const blog = inject(BlogService);
 * const posts = blog.getAllPosts();
 * const post = blog.getPostBySlug('how-ai-is-changing-web-design');
 * ```
 */
@Injectable({ providedIn: 'root' })
export class BlogService {
  /** Returns all blog posts sorted by date (newest first). */
  getAllPosts(): readonly BlogPost[] {
    return POSTS;
  }

  /** Returns a single blog post by its URL slug, or undefined if not found. */
  getPostBySlug(slug: string): BlogPost | undefined {
    return POSTS.find((p) => p.slug === slug);
  }
}
