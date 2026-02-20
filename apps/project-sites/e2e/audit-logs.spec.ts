/**
 * E2E tests for the Audit Logs feature.
 *
 * Tests that the Logs modal UI works correctly, action labels are comprehensive,
 * log metadata renders properly, the auto-refresh mechanism exists, and the
 * underline hover animation is applied to links.
 */

import { test, expect } from './fixtures.js';

test.describe('Audit Logs Modal', () => {
  test('Logs modal exists with all required elements', async ({ page }) => {
    await page.goto('/');

    const logsModal = page.locator('#site-logs-modal');
    await expect(logsModal).toBeAttached();
    await expect(logsModal).not.toHaveClass(/visible/);

    // Required child elements
    await expect(page.locator('#logs-modal-site-name')).toBeAttached();
    await expect(page.locator('#logs-container')).toBeAttached();
    await expect(page.locator('#logs-count-label')).toBeAttached();
    await expect(page.locator('.logs-refresh-btn')).toBeAttached();
  });

  test('Logs modal auto-refresh timer starts on open and stops on close', async ({ page }) => {
    await page.goto('/');

    // Verify the auto-refresh timer variable exists
    const hasAutoRefresh = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>)._logsAutoRefreshTimer !== 'undefined';
    });
    expect(hasAutoRefresh).toBe(true);

    // Initially null
    const initialTimer = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown>)._logsAutoRefreshTimer;
    });
    expect(initialTimer).toBeNull();

    // Opening the logs modal should start the timer
    await page.evaluate(() => {
      const fn = (window as unknown as Record<string, (id: string, name: string) => void>).openSiteLogsModal;
      if (fn) fn('test-site-id', 'Test Site');
    });

    const timerAfterOpen = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown>)._logsAutoRefreshTimer;
    });
    expect(timerAfterOpen).not.toBeNull();

    // Closing should clear the timer
    await page.evaluate(() => {
      const fn = (window as unknown as Record<string, () => void>).closeSiteLogsModal;
      if (fn) fn();
    });

    const timerAfterClose = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown>)._logsAutoRefreshTimer;
    });
    expect(timerAfterClose).toBeNull();
  });

  test('openSiteLogsModal sets the site name in the modal header', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      const fn = (window as unknown as Record<string, (id: string, name: string) => void>).openSiteLogsModal;
      if (fn) fn('site-123', 'My Test Site');
    });

    const siteName = await page.locator('#logs-modal-site-name').textContent();
    expect(siteName).toBe('My Test Site');

    // Clean up
    await page.evaluate(() => {
      const fn = (window as unknown as Record<string, () => void>).closeSiteLogsModal;
      if (fn) fn();
    });
  });
});

test.describe('Audit Log Action Labels', () => {
  test('formatActionLabel covers all site lifecycle actions', async ({ page }) => {
    await page.goto('/');

    const labels = await page.evaluate(() => {
      const fn = (window as unknown as Record<string, (s: string) => string>).formatActionLabel;
      if (typeof fn !== 'function') return null;
      return {
        siteCreated: fn('site.created'),
        siteCreatedSearch: fn('site.created_from_search'),
        siteDeleted: fn('site.deleted'),
        siteUpdated: fn('site.updated'),
        siteReset: fn('site.reset'),
        siteDeployed: fn('site.deployed'),
        siteDeployStarted: fn('site.deploy_started'),
        slugChanged: fn('site.slug_changed'),
        nameChanged: fn('site.name_changed'),
        cacheInvalidated: fn('site.cache_invalidated'),
        r2MigrationStarted: fn('site.r2_migration_started'),
        r2MigrationComplete: fn('site.r2_migration_complete'),
        r2MigrationFailed: fn('site.r2_migration_failed'),
      };
    });

    expect(labels).not.toBeNull();
    if (labels) {
      expect(labels.siteCreated).toBe('Site Created');
      expect(labels.siteCreatedSearch).toBe('Site Created');
      expect(labels.siteDeleted).toBe('Site Deleted');
      expect(labels.siteUpdated).toBe('Site Updated');
      expect(labels.siteReset).toBe('Site Reset');
      expect(labels.siteDeployed).toBe('Site Deployed');
      expect(labels.siteDeployStarted).toBe('Deploy Started');
      expect(labels.slugChanged).toBe('URL Changed');
      expect(labels.nameChanged).toBe('Name Changed');
      expect(labels.cacheInvalidated).toBe('Cache Cleared');
      expect(labels.r2MigrationStarted).toBe('File Migration Started');
      expect(labels.r2MigrationComplete).toBe('File Migration Complete');
      expect(labels.r2MigrationFailed).toBe('File Migration Failed');
    }
  });

  test('formatActionLabel covers all workflow actions', async ({ page }) => {
    await page.goto('/');

    const labels = await page.evaluate(() => {
      const fn = (window as unknown as Record<string, (s: string) => string>).formatActionLabel;
      if (typeof fn !== 'function') return null;
      return {
        queued: fn('workflow.queued'),
        started: fn('workflow.started'),
        completed: fn('workflow.completed'),
        failed: fn('workflow.failed'),
        statusUpdate: fn('workflow.status_update'),
        phaseResearch: fn('workflow.phase.research'),
        phaseGeneration: fn('workflow.phase.generation'),
        phaseDeployment: fn('workflow.phase.deployment'),
        profileStarted: fn('workflow.step.profile_research_started'),
        profileComplete: fn('workflow.step.profile_research_complete'),
        parallelStarted: fn('workflow.step.parallel_research_started'),
        parallelComplete: fn('workflow.step.parallel_research_complete'),
        htmlStarted: fn('workflow.step.html_generation_started'),
        htmlComplete: fn('workflow.step.html_generation_complete'),
        legalStarted: fn('workflow.step.legal_scoring_started'),
        legalComplete: fn('workflow.step.legal_and_scoring_complete'),
        uploadStarted: fn('workflow.step.upload_started'),
        uploadComplete: fn('workflow.step.upload_to_r2_complete'),
        publishStarted: fn('workflow.step.publishing_started'),
        stepFailed: fn('workflow.step.failed'),
      };
    });

    expect(labels).not.toBeNull();
    if (labels) {
      expect(labels.queued).toBe('Build Queued');
      expect(labels.started).toBe('Build Started');
      expect(labels.completed).toBe('Build Completed');
      expect(labels.failed).toBe('Build Failed');
      expect(labels.statusUpdate).toBe('Status Update');
      expect(labels.phaseResearch).toBe('Research Phase');
      expect(labels.phaseGeneration).toBe('Generation Phase');
      expect(labels.phaseDeployment).toBe('Deployment Phase');
      expect(labels.profileStarted).toBe('Researching Business');
      expect(labels.profileComplete).toBe('Profile Research Done');
      expect(labels.parallelStarted).toBe('Researching Details');
      expect(labels.parallelComplete).toBe('Research Complete');
      expect(labels.htmlStarted).toBe('Generating Website');
      expect(labels.htmlComplete).toBe('Website Generated');
      expect(labels.legalStarted).toBe('Creating Legal Pages');
      expect(labels.legalComplete).toBe('Legal Pages Ready');
      expect(labels.uploadStarted).toBe('Uploading Files');
      expect(labels.uploadComplete).toBe('Files Uploaded');
      expect(labels.publishStarted).toBe('Publishing Site');
      expect(labels.stepFailed).toBe('Step Failed');
    }
  });

  test('formatActionLabel covers auth, billing, and domain actions', async ({ page }) => {
    await page.goto('/');

    const labels = await page.evaluate(() => {
      const fn = (window as unknown as Record<string, (s: string) => string>).formatActionLabel;
      if (typeof fn !== 'function') return null;
      return {
        magicLinkRequested: fn('auth.magic_link_requested'),
        magicLinkVerified: fn('auth.magic_link_verified'),
        googleOauthStarted: fn('auth.google_oauth_started'),
        googleOauthVerified: fn('auth.google_oauth_verified'),
        checkoutCreated: fn('billing.checkout_created'),
        portalOpened: fn('billing.portal_opened'),
        hostnameProvisioned: fn('hostname.provisioned'),
        hostnameDeleted: fn('hostname.deleted'),
        hostnameVerified: fn('hostname.verified'),
        hostnameSetPrimary: fn('hostname.set_primary'),
        hostnameResetPrimary: fn('hostname.reset_primary'),
        hostnameUnsubscribed: fn('hostname.unsubscribed'),
        hostnameDeprovisioned: fn('hostname.deprovisioned'),
        domainPurchase: fn('domain.purchase_initiated'),
        fileUpdated: fn('file.updated'),
        fileDeleted: fn('file.deleted'),
        contactForm: fn('contact.form_submitted'),
        publishedFromBolt: fn('site.published_from_bolt'),
        notifDomainVerified: fn('notification.domain_verified_sent'),
        notifBuildComplete: fn('notification.build_complete_sent'),
      };
    });

    expect(labels).not.toBeNull();
    if (labels) {
      expect(labels.magicLinkRequested).toBe('Sign-In Link Sent');
      expect(labels.magicLinkVerified).toBe('Signed In (Email)');
      expect(labels.googleOauthStarted).toBe('Google Sign-In Started');
      expect(labels.googleOauthVerified).toBe('Signed In (Google)');
      expect(labels.checkoutCreated).toBe('Checkout Started');
      expect(labels.portalOpened).toBe('Billing Portal Opened');
      expect(labels.hostnameProvisioned).toBe('Domain Added');
      expect(labels.hostnameDeleted).toBe('Domain Deleted');
      expect(labels.hostnameVerified).toBe('Domain Verified');
      expect(labels.hostnameSetPrimary).toBe('Primary Domain Set');
      expect(labels.hostnameResetPrimary).toBe('Primary Domain Reset');
      expect(labels.hostnameUnsubscribed).toBe('Domain Removed');
      expect(labels.hostnameDeprovisioned).toBe('Domain Removed');
      expect(labels.domainPurchase).toBe('Domain Purchase Started');
      expect(labels.fileUpdated).toBe('File Saved');
      expect(labels.fileDeleted).toBe('File Deleted');
      expect(labels.contactForm).toBe('Contact Form Sent');
      expect(labels.publishedFromBolt).toBe('Published from Bolt');
      expect(labels.notifDomainVerified).toBe('Domain Notification Sent');
      expect(labels.notifBuildComplete).toBe('Build Notification Sent');
    }
  });

  test('formatActionLabel provides fallback for unknown actions', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const fn = (window as unknown as Record<string, (s: string) => string>).formatActionLabel;
      if (typeof fn !== 'function') return null;
      return fn('some.unknown.action');
    });

    // Should capitalize words and replace dots with spaces
    expect(result).toBe('Some Unknown Action');
  });
});

test.describe('Log Metadata Rendering', () => {
  test('formatLogMeta displays human-readable message first', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const fn = (window as unknown as Record<string, (meta: unknown, action: string) => string>).formatLogMeta;
      if (typeof fn !== 'function') return null;
      return fn(
        JSON.stringify({
          message: 'Site rebuild triggered for my-biz',
          slug: 'my-biz',
          has_context: true,
        }),
        'site.reset',
      );
    });

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('Site rebuild triggered for my-biz');
    }
  });

  test('formatLogMeta handles elapsed_ms timing info', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const fn = (window as unknown as Record<string, (meta: unknown, action: string) => string>).formatLogMeta;
      if (typeof fn !== 'function') return null;
      return fn(
        JSON.stringify({
          message: 'Found business type: salon',
          elapsed_ms: 2500,
          services_count: 6,
        }),
        'workflow.step.profile_research_complete',
      );
    });

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('Found business type: salon');
      expect(result).toContain('2.5s');
    }
  });

  test('formatLogMeta handles object input (not just string)', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const fn = (window as unknown as Record<string, (meta: unknown, action: string) => string>).formatLogMeta;
      if (typeof fn !== 'function') return null;
      return fn({ message: 'Direct object test', slug: 'test-slug' }, 'site.updated');
    });

    expect(result).not.toBeNull();
    if (result) {
      expect(result).toContain('Direct object test');
    }
  });
});

test.describe('Log Color Classes', () => {
  test('getLogColorClass maps actions to correct colors', async ({ page }) => {
    await page.goto('/');

    const colors = await page.evaluate(() => {
      const fn = (window as unknown as Record<string, (s: string) => string>).getLogColorClass;
      if (typeof fn !== 'function') return null;
      return {
        created: fn('site.created'),
        deleted: fn('site.deleted'),
        reset: fn('site.reset'),
        deployed: fn('site.deployed'),
        research: fn('workflow.step.profile_research_started'),
        updated: fn('site.updated'),
        failed: fn('workflow.step.failed'),
        webhook: fn('webhook.stripe.charge.refund'),
      };
    });

    expect(colors).not.toBeNull();
    if (colors) {
      expect(colors.created).toBe('log-c-green');
      expect(colors.deleted).toBe('log-c-red');
      expect(colors.reset).toBe('log-c-amber');
      expect(colors.deployed).toBe('log-c-purple');
      expect(colors.research).toBe('log-c-cyan');
      expect(colors.updated).toBe('log-c-blue');
      expect(colors.failed).toBe('log-c-red');
      expect(colors.webhook).toBe('log-c-muted');
    }
  });
});

test.describe('Log Icons', () => {
  test('getLogIcon returns SVGs for all action categories', async ({ page }) => {
    await page.goto('/');

    const icons = await page.evaluate(() => {
      const fn = (window as unknown as Record<string, (s: string) => string>).getLogIcon;
      if (typeof fn !== 'function') return null;
      return {
        created: fn('site.created'),
        deleted: fn('site.deleted'),
        reset: fn('site.reset'),
        generation: fn('workflow.step.html_generation_started'),
        research: fn('workflow.step.profile_research_started'),
        upload: fn('workflow.step.upload_started'),
        auth: fn('auth.magic_link_verified'),
        hostname: fn('hostname.provisioned'),
        slug: fn('site.slug_changed'),
        billing: fn('billing.checkout_created'),
        notification: fn('notification.build_complete_sent'),
        file: fn('file.updated'),
        cache: fn('site.cache_invalidated'),
        workflow: fn('workflow.status_update'),
        contact: fn('contact.form_submitted'),
        unknown: fn('some.random.action'),
      };
    });

    expect(icons).not.toBeNull();
    if (icons) {
      // All should return SVG strings
      for (const [key, val] of Object.entries(icons)) {
        expect(val, `Icon for "${key}" should be an SVG`).toContain('<svg');
        expect(val, `Icon for "${key}" should close SVG`).toContain('</svg>');
      }
    }
  });
});

test.describe('Link Underline Hover Animation', () => {
  test('links have center-out underline ::after pseudo-element CSS', async ({ page }) => {
    await page.goto('/');

    // Check that the CSS rule for link ::after exists in stylesheets
    const hasRule = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            const cssRule = rule as CSSStyleRule;
            if (cssRule.selectorText && cssRule.selectorText.includes('::after') && cssRule.selectorText.includes('a:not(')) {
              return true;
            }
          }
        } catch (_e) { /* cross-origin */ }
      }
      return false;
    });
    expect(hasRule).toBe(true);
  });

  test('footer links have working underline animation styles', async ({ page }) => {
    await page.goto('/');

    // Get a footer link (in .footer-bottom section)
    const footerLink = page.locator('.footer-bottom a').first();
    await expect(footerLink).toBeAttached();

    // The ::after pseudo-element should have position: absolute
    const pseudoStyles = await footerLink.evaluate((el) => {
      const computed = window.getComputedStyle(el, '::after');
      return {
        content: computed.content,
        position: computed.position,
      };
    });

    expect(pseudoStyles.position).toBe('absolute');
  });
});

test.describe('Default Tooltip', () => {
  test('Default tooltip text is concise', async ({ page }) => {
    await page.goto('/');

    // Verify the JS function that renders Default chip uses concise text
    const renderCode = await page.evaluate(() => {
      // Search for the renderDomainModalHostnames function
      const fn = (window as unknown as Record<string, () => void>).renderDomainModalHostnames;
      return fn ? fn.toString() : '';
    });

    if (renderCode) {
      // Should contain the concise tooltip text, not the old verbose one
      expect(renderCode).toContain('Default URL for this site');
      expect(renderCode).not.toContain('Free subdomain included with your site. Upgrade for a custom domain.');
    }
  });
});

test.describe('Improve AI Link Positioning', () => {
  test('.improve-ai-link has position:relative and bottom:-2px', async ({ page }) => {
    await page.goto('/');

    const styles = await page.evaluate(() => {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            const cssRule = rule as CSSStyleRule;
            if (cssRule.selectorText === '.improve-ai-link') {
              return {
                position: cssRule.style.position,
                bottom: cssRule.style.bottom,
              };
            }
          }
        } catch (_e) { /* cross-origin */ }
      }
      return null;
    });

    expect(styles).not.toBeNull();
    if (styles) {
      expect(styles.position).toBe('relative');
      expect(styles.bottom).toBe('-2px');
    }
  });
});
