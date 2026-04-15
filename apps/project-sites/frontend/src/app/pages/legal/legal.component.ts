import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

interface LegalPage {
  title: string;
  breadcrumb: string;
  lastUpdated: string;
  content: string;
}

const PAGES: Record<string, LegalPage> = {
  privacy: {
    title: 'Privacy Policy',
    breadcrumb: 'Privacy',
    lastUpdated: 'March 1, 2026',
    content: `
<p class="legal-intro">Megabyte LLC ("we," "us," or "our") operates the Project Sites platform at <strong>projectsites.dev</strong>. This policy explains how we collect, use, share, and protect your personal data.</p>

<h2>1. Information We Collect</h2>

<h3>1.1 Information You Provide</h3>
<ul>
  <li><strong>Account Information:</strong> Email address used for authentication via magic link or Google OAuth. We do not store passwords.</li>
  <li><strong>Business Information:</strong> Business name, address, phone number, website URL, and any descriptions you provide when creating a site.</li>
  <li><strong>Payment Information:</strong> Billing details are processed securely through Stripe. We never store credit card numbers, CVVs, or full card details on our servers.</li>
  <li><strong>Communications:</strong> Messages you send through our contact form or support channels.</li>
  <li><strong>User Content:</strong> Website files, images, and text you upload or modify through our platform.</li>
</ul>

<h3>1.2 Information Collected Automatically</h3>
<ul>
  <li><strong>Usage Data:</strong> Pages visited, features used, interaction patterns, and session duration for improving our service.</li>
  <li><strong>Device Information:</strong> Browser type, operating system, screen resolution, and language preferences.</li>
  <li><strong>Log Data:</strong> IP addresses, request timestamps, referral URLs, and server response codes for security and diagnostics.</li>
  <li><strong>Cookies:</strong> We use essential cookies for authentication session management. We do not use third-party tracking cookies.</li>
</ul>

<h3>1.3 Information from Third Parties</h3>
<ul>
  <li><strong>Google Places:</strong> Public business information (name, address, phone, hours, reviews) when you search for and select a business.</li>
  <li><strong>Google OAuth:</strong> Your email address and name when you sign in with Google. We request minimal permissions.</li>
</ul>

<h2>2. How We Use Your Information</h2>
<ul>
  <li>To create, host, and serve your AI-generated website.</li>
  <li>To authenticate your identity and manage your account securely.</li>
  <li>To process payments, manage subscriptions, and send invoices.</li>
  <li>To send transactional emails including magic links, build notifications, and domain verification alerts.</li>
  <li>To improve our AI models, platform features, and user experience.</li>
  <li>To detect, prevent, and respond to fraud, abuse, and security incidents.</li>
  <li>To comply with legal obligations and respond to lawful requests.</li>
</ul>

<h2>3. Data Sharing and Disclosure</h2>
<p>We do not sell, rent, or trade your personal information. We share data only with service providers necessary to operate the platform:</p>
<ul>
  <li><strong>Cloudflare:</strong> Hosting, CDN, DNS, DDoS protection, and edge computing infrastructure.</li>
  <li><strong>Stripe:</strong> Payment processing, subscription management, and fraud prevention.</li>
  <li><strong>Google Places API:</strong> Business search, verification, and data enrichment.</li>
  <li><strong>PostHog:</strong> Privacy-focused, anonymous usage analytics. No personal identifiers are sent.</li>
  <li><strong>Sentry:</strong> Error tracking and performance monitoring. Personal data is redacted before transmission.</li>
  <li><strong>Resend / SendGrid:</strong> Transactional email delivery (magic links, notifications).</li>
</ul>
<p>We may also disclose information when required by law, to protect our rights, or to prevent harm to users or the public.</p>

<h2>4. Data Security</h2>
<ul>
  <li>All data is encrypted in transit using TLS 1.3 and at rest using AES-256.</li>
  <li>Authentication tokens are cryptographically signed (HMAC-SHA256) and expire automatically.</li>
  <li>We use Cloudflare's global network for DDoS protection, WAF, and bot management.</li>
  <li>Database access is restricted and monitored. All mutations are logged in an immutable audit trail.</li>
  <li>We conduct regular security reviews and follow OWASP best practices.</li>
</ul>

<h2>5. Data Retention</h2>
<ul>
  <li><strong>Account data:</strong> Retained while your account is active. Deleted within 30 days of account closure.</li>
  <li><strong>Website content:</strong> Retained while your site is active. Deleted within 7 days of site deletion.</li>
  <li><strong>Audit logs:</strong> Retained for 90 days for security and compliance purposes.</li>
  <li><strong>Payment records:</strong> Retained as required by tax and financial regulations (typically 7 years).</li>
</ul>

<h2>6. Your Rights</h2>
<p>Depending on your jurisdiction, you may have the following rights:</p>
<ul>
  <li><strong>Access:</strong> Request a copy of the personal data we hold about you.</li>
  <li><strong>Correction:</strong> Request correction of inaccurate or incomplete data.</li>
  <li><strong>Deletion:</strong> Request deletion of your personal data ("right to be forgotten").</li>
  <li><strong>Export:</strong> Export your website files from the admin dashboard at any time.</li>
  <li><strong>Objection:</strong> Object to processing of your data for specific purposes.</li>
  <li><strong>Restriction:</strong> Request restriction of processing in certain circumstances.</li>
</ul>
<p>To exercise any of these rights, contact us at <a href="mailto:privacy@projectsites.dev">privacy@projectsites.dev</a>. We will respond within 30 days.</p>

<h2>7. Children's Privacy</h2>
<p>Our service is not directed to children under 16. We do not knowingly collect personal information from children. If you believe a child has provided us with personal data, please contact us and we will promptly delete it.</p>

<h2>8. International Data Transfers</h2>
<p>Your data may be processed in data centers located in various countries through Cloudflare's global network. We ensure appropriate safeguards are in place for international transfers in compliance with applicable data protection laws.</p>

<h2>9. Changes to This Policy</h2>
<p>We may update this Privacy Policy from time to time. Material changes will be communicated via email to your registered address at least 14 days before taking effect. The "Last Updated" date at the top of this page indicates when the policy was last revised.</p>

<h2>10. Contact Us</h2>
<p>For privacy-related inquiries, data requests, or concerns:</p>
<ul>
  <li><strong>Email:</strong> <a href="mailto:privacy@projectsites.dev">privacy@projectsites.dev</a></li>
  <li><strong>Company:</strong> Megabyte LLC</li>
</ul>
    `,
  },
  terms: {
    title: 'Terms of Service',
    breadcrumb: 'Terms',
    lastUpdated: 'March 1, 2026',
    content: `
<p class="legal-intro">These Terms of Service ("Terms") are a binding agreement between you and Megabyte LLC governing your use of the Project Sites platform at <strong>projectsites.dev</strong>. By using the service, you agree to these Terms.</p>

<h2>1. Service Description</h2>
<p>Project Sites is an AI-powered website builder that generates, hosts, and maintains professional business websites. The service includes:</p>
<ul>
  <li>AI-powered website generation from business information and public data sources.</li>
  <li>Website hosting on Cloudflare's global edge network with SSL/TLS encryption.</li>
  <li>Custom domain management and DNS configuration.</li>
  <li>A web-based dashboard for site management, file editing, and analytics.</li>
  <li>Transactional email services for authentication and notifications.</li>
</ul>

<h2>2. Account Registration and Responsibilities</h2>
<ul>
  <li>You must provide a valid email address to create an account. Accounts created with disposable or fraudulent email addresses may be suspended.</li>
  <li>You are responsible for maintaining the security of your account credentials and for all activities that occur under your account.</li>
  <li>You must provide accurate and truthful business information when creating a website.</li>
  <li>You must not use the service for any unlawful purpose, to create misleading content, or to impersonate another business or individual.</li>
  <li>You must be at least 16 years of age to use this service.</li>
</ul>

<h2>3. Content Ownership and Licenses</h2>

<h3>3.1 Your Content</h3>
<ul>
  <li>You retain full ownership of all content you provide, upload, or create through the platform.</li>
  <li>You grant us a non-exclusive, worldwide, royalty-free license to host, display, reproduce, and serve your content solely as necessary to provide the service.</li>
  <li>This license terminates when your content is deleted from our platform.</li>
</ul>

<h3>3.2 AI-Generated Content</h3>
<ul>
  <li>AI-generated content (text, layout, styling) is created using your business information and publicly available data.</li>
  <li>You own the AI-generated content created for your website and may use it freely.</li>
  <li>AI-generated content is provided "as-is." You are solely responsible for reviewing, editing, and approving all content before it is made publicly accessible.</li>
  <li>We do not guarantee the accuracy, completeness, or legal compliance of AI-generated content.</li>
</ul>

<h3>3.3 Our Intellectual Property</h3>
<p>The Project Sites platform, including its source code, design, branding, and documentation, is owned by Megabyte LLC and protected by intellectual property laws. These Terms do not grant you any rights to our intellectual property beyond what is necessary to use the service.</p>

<h2>4. Billing, Payments, and Cancellation</h2>
<ul>
  <li><strong>Free Tier:</strong> Free website previews are available without payment. Free sites are hosted on a subdomain (slug.projectsites.dev) with a promotional branding bar.</li>
  <li><strong>Paid Plans:</strong> Paid plans remove branding, enable custom domains, and include priority support. Plans are billed monthly or annually at prices listed on our pricing page.</li>
  <li><strong>Payment Processing:</strong> All payments are processed securely through Stripe. We accept major credit and debit cards.</li>
  <li><strong>Cancellation:</strong> You may cancel your subscription at any time from the billing portal. Your site remains active and fully functional through the end of the current billing period.</li>
  <li><strong>Refunds:</strong> We offer a 14-day money-back guarantee on your first payment. After 14 days, payments are non-refundable. Contact us within 14 days of your first charge for a full refund.</li>
  <li><strong>Post-Cancellation:</strong> After your billing period ends, your site reverts to the free tier with subdomain hosting and branding bar. Your content and files are preserved.</li>
  <li><strong>Price Changes:</strong> We will provide at least 30 days' notice of any price changes. Existing subscriptions continue at their current rate until the next renewal.</li>
</ul>

<h2>5. Acceptable Use</h2>
<p>You agree not to use the service to:</p>
<ul>
  <li>Violate any applicable law, regulation, or third-party rights.</li>
  <li>Create websites containing malware, phishing pages, or cyberattack infrastructure.</li>
  <li>Distribute spam, conduct link farming, or engage in deceptive SEO practices.</li>
  <li>Create websites impersonating another business, person, or organization.</li>
  <li>Host content that promotes violence, hate speech, discrimination, or illegal activities.</li>
  <li>Attempt to gain unauthorized access to our systems, other users' accounts, or data.</li>
  <li>Interfere with or disrupt the integrity or performance of the service.</li>
</ul>
<p>We reserve the right to suspend or terminate accounts that violate these terms with or without notice, depending on severity.</p>

<h2>6. Service Availability and Support</h2>
<ul>
  <li>We target 99.9% uptime for published websites. This is a goal, not a guarantee.</li>
  <li>We are not liable for downtime caused by scheduled maintenance (announced at least 24 hours in advance), force majeure events, or third-party service failures.</li>
  <li>Support is available via email. Paid plan users receive priority response times.</li>
</ul>

<h2>7. Limitation of Liability</h2>
<p>To the maximum extent permitted by applicable law:</p>
<ul>
  <li>Our total aggregate liability for any claims arising from or related to the service is limited to the amount you have paid us in the 12 months preceding the claim, or $100, whichever is greater.</li>
  <li>We are not liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, revenue, data, or business opportunities.</li>
  <li>We are not liable for damages arising from AI-generated content, including inaccurate business descriptions, legal claims from third parties, or lost business due to content errors.</li>
</ul>

<h2>8. Indemnification</h2>
<p>You agree to indemnify, defend, and hold harmless Megabyte LLC, its officers, directors, employees, and agents from any claims, damages, losses, liabilities, and expenses (including reasonable legal fees) arising from your use of the service, your content, or your violation of these Terms.</p>

<h2>9. Termination</h2>
<ul>
  <li>You may close your account at any time by contacting support or deleting all sites from your dashboard.</li>
  <li>We may suspend or terminate your account for violation of these Terms, non-payment, or extended inactivity (12+ months with no active sites).</li>
  <li>Upon termination, we will delete your data in accordance with our Privacy Policy retention schedule.</li>
</ul>

<h2>10. Dispute Resolution</h2>
<p>Any disputes arising from these Terms will be resolved through binding arbitration under the rules of the American Arbitration Association, conducted in the state of Delaware, USA. You waive any right to participate in class action lawsuits or class-wide arbitration.</p>

<h2>11. Governing Law</h2>
<p>These Terms are governed by the laws of the State of Delaware, United States, without regard to conflict of law principles.</p>

<h2>12. Changes to These Terms</h2>
<p>We may update these Terms from time to time. Material changes will be communicated via email at least 14 days before taking effect. Continued use of the service after changes take effect constitutes your acceptance of the revised Terms.</p>

<h2>13. Contact</h2>
<p>For questions about these Terms:</p>
<ul>
  <li><strong>Email:</strong> <a href="mailto:legal@projectsites.dev">legal@projectsites.dev</a></li>
  <li><strong>Company:</strong> Megabyte LLC</li>
</ul>
    `,
  },
  content: {
    title: 'Content Policy',
    breadcrumb: 'Content Policy',
    lastUpdated: 'March 1, 2026',
    content: `
<p class="legal-intro">This Content Policy defines what is and is not allowed on websites hosted by Project Sites. All users must follow this policy. Violations may lead to content removal, site suspension, or account termination.</p>

<h2>1. Permitted Use</h2>
<p>Project Sites is designed for hosting legitimate websites. Permitted uses include:</p>
<ul>
  <li>Business websites for real, operating businesses and services.</li>
  <li>Personal websites, portfolios, and resumes.</li>
  <li>Non-profit, community, and religious organization websites.</li>
  <li>Educational, informational, and journalistic content.</li>
  <li>Event pages, landing pages, and promotional microsites.</li>
</ul>

<h2>2. Prohibited Content</h2>
<p>The following content is strictly prohibited on our platform:</p>

<h3>2.1 Illegal and Harmful Content</h3>
<ul>
  <li>Content that violates any applicable local, state, national, or international law.</li>
  <li>Content promoting, facilitating, or glorifying violence, terrorism, or self-harm.</li>
  <li>Hate speech, content promoting discrimination based on race, ethnicity, gender, religion, sexual orientation, disability, or national origin.</li>
  <li>Child sexual abuse material (CSAM) or any content exploiting minors.</li>
  <li>Sale or promotion of illegal drugs, weapons, or controlled substances.</li>
</ul>

<h3>2.2 Deceptive and Fraudulent Content</h3>
<ul>
  <li>Websites impersonating another business, individual, or government entity.</li>
  <li>Misleading or false business information, fake reviews, or fabricated credentials.</li>
  <li>Phishing pages designed to steal credentials, personal information, or financial data.</li>
  <li>Pyramid schemes, Ponzi schemes, or other fraudulent business models.</li>
  <li>Deceptive pricing, hidden fees, or bait-and-switch tactics.</li>
</ul>

<h3>2.3 Technical Violations</h3>
<ul>
  <li>Malware, viruses, trojans, ransomware, or any malicious code.</li>
  <li>Cryptomining scripts or unauthorized resource consumption.</li>
  <li>Spam, bulk email sending infrastructure, or link farming schemes.</li>
  <li>Deceptive SEO practices including cloaking, keyword stuffing, or hidden text.</li>
  <li>Content designed to exploit browser or device vulnerabilities.</li>
</ul>

<h3>2.4 Intellectual Property Violations</h3>
<ul>
  <li>Content that infringes copyrights, trademarks, patents, or trade secrets.</li>
  <li>Unauthorized use of logos, brand names, or proprietary content.</li>
  <li>Counterfeit goods or services.</li>
</ul>

<h3>2.5 Restricted Content</h3>
<ul>
  <li>Adult content is permitted only with proper age verification mechanisms and clear content warnings. It must comply with all applicable laws.</li>
  <li>Gambling content must comply with jurisdictional regulations and include responsible gambling notices.</li>
  <li>Alcohol, tobacco, and cannabis businesses must comply with advertising regulations in their jurisdiction.</li>
</ul>

<h2>3. AI-Generated Content Responsibilities</h2>
<p>Our AI generates website content based on publicly available business information and data you provide. As the site owner, you are responsible for:</p>
<ul>
  <li><strong>Review:</strong> Carefully reviewing all AI-generated content for accuracy, completeness, and appropriateness before publishing.</li>
  <li><strong>Truthfulness:</strong> Ensuring all claims about your business, products, services, credentials, and qualifications are truthful and not misleading.</li>
  <li><strong>Compliance:</strong> Ensuring your website complies with industry-specific regulations (healthcare disclaimers, financial disclosures, food safety notices, etc.).</li>
  <li><strong>Updates:</strong> Promptly updating content when your business information, hours, prices, or services change.</li>
  <li><strong>Third-Party Rights:</strong> Ensuring that content does not infringe on the intellectual property or privacy rights of third parties.</li>
</ul>

<h2>4. Enforcement</h2>
<p>We enforce this policy through a graduated response system:</p>
<ul>
  <li><strong>Notice:</strong> For first-time or minor violations, we will notify you and provide a reasonable timeframe to resolve the issue.</li>
  <li><strong>Content Removal:</strong> If you do not resolve the issue, we may remove the specific content that violates this policy.</li>
  <li><strong>Site Suspension:</strong> For repeated or serious violations, we may suspend your site and restrict access.</li>
  <li><strong>Account Termination:</strong> For severe violations (malware, CSAM, phishing), accounts will be terminated immediately without prior notice and reported to appropriate authorities.</li>
</ul>
<p>We reserve the right to take immediate action without notice for content that poses an imminent threat to safety, security, or legal compliance.</p>

<h2>5. Appeals</h2>
<p>If you believe your content was removed or your account was suspended in error, you may appeal by contacting us with a detailed explanation. We will review your appeal within 5 business days and respond with our decision.</p>

<h2>6. Reporting Violations</h2>
<p>To report content that violates this policy, please contact us with the following information:</p>
<ul>
  <li>The URL of the content in question.</li>
  <li>A description of the violation.</li>
  <li>Your contact information (optional but helpful for follow-up).</li>
</ul>
<p>Reports can be sent to: <a href="mailto:abuse@projectsites.dev">abuse@projectsites.dev</a></p>

<h2>7. DMCA and Copyright Notices</h2>
<p>If you believe content on our platform infringes your copyright, please submit a DMCA takedown notice to <a href="mailto:dmca@projectsites.dev">dmca@projectsites.dev</a> including:</p>
<ul>
  <li>Identification of the copyrighted work claimed to have been infringed.</li>
  <li>Identification of the material that is claimed to be infringing, with enough detail to locate it.</li>
  <li>Your contact information (name, address, phone, email).</li>
  <li>A statement that you have a good faith belief that the use is not authorized.</li>
  <li>A statement, under penalty of perjury, that the information is accurate and you are authorized to act on behalf of the copyright owner.</li>
  <li>Your physical or electronic signature.</li>
</ul>
    `,
  },
};

@Component({
  selector: 'app-legal',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="legal-page">
      <div class="legal-inner">
        <nav class="breadcrumbs">
          <a routerLink="/" class="breadcrumb-link">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            Home
          </a>
          <span class="breadcrumb-sep">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </span>
          <span class="breadcrumb-current">{{ page()?.breadcrumb }}</span>
        </nav>

        <div class="legal-header">
          <h1>{{ page()?.title }}</h1>
          <div class="legal-meta">
            <span class="legal-updated">Last updated: {{ page()?.lastUpdated }}</span>
          </div>
        </div>

        <div class="legal-content" [innerHTML]="page()?.content || ''"></div>
      </div>
    </section>

    <footer class="site-footer">
      <div class="footer-inner">
        <div class="footer-social">
          <a href="https://github.com/HeyMegabyte" target="_blank" rel="noopener noreferrer" aria-label="GitHub" data-tooltip="GitHub">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
          </a>
          <a href="https://x.com/HeyMegabyte" target="_blank" rel="noopener noreferrer" aria-label="X" data-tooltip="X / Twitter">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </a>
          <a href="https://www.linkedin.com/in/blzalewski" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" data-tooltip="LinkedIn">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
          </a>
          <a href="https://www.youtube.com/@HeyMegabyte" target="_blank" rel="noopener noreferrer" aria-label="YouTube" data-tooltip="YouTube">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
          </a>
          <a href="https://www.instagram.com/heymegabyteofficial/" target="_blank" rel="noopener noreferrer" aria-label="Instagram" data-tooltip="Instagram">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z"/></svg>
          </a>
          <a href="https://www.facebook.com/HeyMegabyte" target="_blank" rel="noopener noreferrer" aria-label="Facebook" data-tooltip="Facebook">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
          </a>
        </div>
        <div class="footer-bottom">
          <span>&copy; 2026 <a href="https://megabyte.space" target="_blank" rel="noopener noreferrer">Megabyte LLC</a></span>
          <span><a routerLink="/privacy">Privacy Policy</a> | <a routerLink="/terms">Terms of Service</a> | <a routerLink="/content">Content Policy</a></span>
        </div>
      </div>
    </footer>
  `,
  styles: [`
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes glowPulse { 0%, 100% { box-shadow: 0 0 20px rgba(0, 212, 255, 0.03); } 50% { box-shadow: 0 0 30px rgba(0, 212, 255, 0.06); } }

    .legal-page {
      min-height: calc(100vh - 60px - 160px);
      padding: 48px 24px 80px;
      animation: fadeIn 0.3s ease;
      position: relative;
      z-index: var(--z-content);
    }
    .legal-inner {
      max-width: 780px;
      margin: 0 auto;
    }

    /* ── Breadcrumbs ─────── */
    .breadcrumbs {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 36px;
      font-size: 0.82rem;
      animation: fadeInUp 0.4s ease;
      padding: 8px 18px;
      background: rgba(0, 212, 255, 0.04);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(0, 212, 255, 0.08);
      border-radius: 24px;
    }
    .breadcrumb-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--accent);
      text-decoration: none;
      font-weight: 500;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .breadcrumb-link:hover {
      opacity: 0.8;
      text-shadow: 0 0 8px rgba(0, 212, 255, 0.3);
      text-decoration: underline;
    }
    .breadcrumb-link:active { opacity: 0.6; }
    .breadcrumb-link svg { opacity: 0.7; }
    .breadcrumb-sep {
      color: var(--text-muted);
      display: flex;
      align-items: center;
      opacity: 0.4;
    }
    .breadcrumb-current { color: var(--text-secondary); font-weight: 600; }

    /* ── Header (hero-style) ─────── */
    .legal-header {
      margin-bottom: 48px;
      text-align: center;
      animation: fadeInUp 0.5s ease 0.1s both;
    }
    h1 {
      font-size: clamp(2rem, 5vw, 3rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      margin-bottom: 16px;
      background: linear-gradient(135deg, #fff 0%, rgba(0, 212, 255, 0.85) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .legal-meta {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
    }
    .legal-updated {
      font-size: 0.82rem;
      color: var(--text-muted);
      padding: 6px 16px;
      background: linear-gradient(135deg, rgba(0, 212, 255, 0.06), rgba(14, 165, 233, 0.03));
      border: 1px solid rgba(0, 212, 255, 0.1);
      border-radius: 20px;
    }

    /* ── Content card wrapper ─────── */
    .legal-content {
      color: var(--text-secondary);
      line-height: 1.85;
      font-size: 0.93rem;
      animation: fadeInUp 0.6s ease 0.2s both;
      background: linear-gradient(145deg, rgba(13, 13, 40, 0.6), rgba(8, 8, 32, 0.8));
      border: 1px solid rgba(0, 212, 255, 0.06);
      border-radius: 20px;
      padding: 40px 36px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), 0 0 60px rgba(0, 212, 255, 0.02);
      animation: fadeInUp 0.6s ease 0.2s both, glowPulse 6s ease-in-out infinite;
    }

    @media (max-width: 640px) {
      .legal-content { padding: 24px 20px; border-radius: 14px; }
    }

    /* Intro paragraph — glass card */
    :host ::ng-deep .legal-intro {
      font-size: 1.02rem;
      line-height: 1.9;
      color: var(--text-secondary);
      padding: 24px 28px;
      background: linear-gradient(135deg, rgba(0, 212, 255, 0.05), rgba(14, 165, 233, 0.02));
      border: 1px solid rgba(0, 212, 255, 0.1);
      border-radius: 14px;
      margin-bottom: 36px;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
    }

    /* H2 — major sections with accent glow */
    :host ::ng-deep h2 {
      color: #fff;
      font-size: 1.3rem;
      font-weight: 800;
      margin-top: 48px;
      margin-bottom: 18px;
      padding: 16px 20px;
      background: linear-gradient(135deg, rgba(0, 212, 255, 0.04), transparent);
      border: 1px solid rgba(0, 212, 255, 0.08);
      border-radius: 12px;
      letter-spacing: -0.01em;
      position: relative;
    }
    :host ::ng-deep h2::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 3px;
      height: 100%;
      background: linear-gradient(180deg, var(--accent), transparent);
      border-radius: 3px 0 0 3px;
    }

    /* H3 — subsections */
    :host ::ng-deep h3 {
      color: var(--text-primary);
      font-size: 1.05rem;
      font-weight: 700;
      margin-top: 28px;
      margin-bottom: 12px;
      padding-left: 14px;
      border-left: 2px solid rgba(0, 212, 255, 0.2);
    }

    :host ::ng-deep p {
      margin-bottom: 16px;
    }

    /* Lists — card-like items */
    :host ::ng-deep ul {
      margin-bottom: 20px;
      padding-left: 0;
      list-style: none;
    }
    :host ::ng-deep li {
      margin-bottom: 8px;
      padding: 10px 16px 10px 32px;
      position: relative;
      line-height: 1.7;
      background: rgba(0, 212, 255, 0.015);
      border-radius: 8px;
      transition: background 0.2s;
    }
    :host ::ng-deep li:hover {
      background: rgba(0, 212, 255, 0.035);
    }
    :host ::ng-deep li::before {
      content: '';
      position: absolute;
      left: 14px;
      top: 18px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 8px rgba(0, 212, 255, 0.4);
    }

    /* Links */
    :host ::ng-deep .legal-content a {
      color: var(--accent);
      text-decoration: none;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      border-bottom: 1px solid rgba(0, 212, 255, 0.2);
      padding-bottom: 1px;
    }
    :host ::ng-deep .legal-content a:hover {
      border-bottom-color: var(--accent);
      text-shadow: 0 0 8px rgba(0, 212, 255, 0.3);
    }
    :host ::ng-deep strong { color: var(--text-primary); }

    /* ── Footer (matches homepage) ─────── */
    .site-footer {
      padding: 48px 24px 32px;
      border-top: 1px solid var(--border);
      position: relative;
      z-index: var(--z-content);
    }
    .footer-inner {
      max-width: 800px;
      margin: 0 auto;
      text-align: center;
    }
    .footer-social {
      display: flex;
      justify-content: center;
      gap: 18px;
      margin-bottom: 24px;
    }
    .footer-social a {
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(255, 255, 255, 0.6);
      transition: color 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                  transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                  filter 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                  opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .footer-social a svg { width: 20px; height: 20px; }
    .footer-social a:hover {
      transform: translateY(-2px) scale(1.1);
      opacity: 1;
    }
    .footer-social a:active { opacity: 0.5; transform: translateY(0) scale(0.95); }
    .footer-social a[aria-label="GitHub"]:hover { color: #fff; filter: drop-shadow(0 0 8px rgba(255,255,255,0.3)); }
    .footer-social a[aria-label="X"]:hover { color: #fff; filter: drop-shadow(0 0 8px rgba(255,255,255,0.4)); }
    .footer-social a[aria-label="LinkedIn"]:hover { color: #0A66C2; filter: drop-shadow(0 0 8px rgba(10,102,194,0.4)); }
    .footer-social a[aria-label="YouTube"]:hover { color: #FF0000; filter: drop-shadow(0 0 8px rgba(255,0,0,0.4)); }
    .footer-social a[aria-label="Instagram"]:hover { color: #E4405F; filter: drop-shadow(0 0 8px rgba(228,64,95,0.4)); }
    .footer-social a[aria-label="Facebook"]:hover { color: #1877F2; filter: drop-shadow(0 0 8px rgba(24,119,242,0.4)); }
    .footer-bottom {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
    .footer-bottom a {
      color: var(--text-muted);
      text-decoration: none;
      transition: color 0.2s, text-decoration-color 0.2s;
    }
    .footer-bottom a:hover {
      color: var(--accent);
      text-decoration: underline;
      text-underline-offset: 3px;
      text-decoration-thickness: 1px;
    }
    .footer-bottom a:active { opacity: 0.7; }
    @media (max-width: 640px) {
      .footer-bottom {
        flex-direction: column;
        text-align: center;
      }
    }
  `],
})
export class LegalComponent implements OnInit {
  private route = inject(ActivatedRoute);
  page = signal<LegalPage | null>(null);

  ngOnInit(): void {
    const type = this.route.snapshot.data['type'] as string;
    this.page.set(PAGES[type] || null);
  }
}
