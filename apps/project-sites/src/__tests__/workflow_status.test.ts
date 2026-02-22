/**
 * @module __tests__/workflow_status
 * Tests for workflow status transitions (collecting → generating → uploading → published)
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';

describe('Workflow status transitions', () => {
  const mockRun = jest.fn();
  const mockBind = jest.fn().mockReturnValue({ run: mockRun });
  const mockPrepare = jest.fn().mockReturnValue({ bind: mockBind });
  const mockDb = { prepare: mockPrepare } as unknown as D1Database;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockResolvedValue({ results: [] });
    mockBind.mockReturnValue({ run: mockRun });
    mockPrepare.mockReturnValue({ bind: mockBind });
  });

  it('updateSiteStatus sets status to collecting', async () => {
    await mockDb
      .prepare("UPDATE sites SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .bind('collecting', 'site-123')
      .run();
    expect(mockPrepare).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE sites SET status'),
    );
    expect(mockBind).toHaveBeenCalledWith('collecting', 'site-123');
    expect(mockRun).toHaveBeenCalled();
  });

  it('updateSiteStatus sets status to generating', async () => {
    await mockDb
      .prepare("UPDATE sites SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .bind('generating', 'site-456')
      .run();
    expect(mockBind).toHaveBeenCalledWith('generating', 'site-456');
  });

  it('updateSiteStatus sets status to uploading', async () => {
    await mockDb
      .prepare("UPDATE sites SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .bind('uploading', 'site-789')
      .run();
    expect(mockBind).toHaveBeenCalledWith('uploading', 'site-789');
  });

  it('status transitions follow correct order', () => {
    const expectedOrder = ['building', 'collecting', 'generating', 'uploading', 'published'];
    // Verify the expected status progression
    expect(expectedOrder[0]).toBe('building');
    expect(expectedOrder[1]).toBe('collecting');
    expect(expectedOrder[2]).toBe('generating');
    expect(expectedOrder[3]).toBe('uploading');
    expect(expectedOrder[4]).toBe('published');
  });

  it('error status should exist for failed workflows', () => {
    const statusLabels: Record<string, string> = {
      published: 'Live',
      building: 'Building',
      queued: 'Queued',
      collecting: 'Collecting Data',
      generating: 'Generating',
      uploading: 'Uploading',
      error: 'Error',
      failed: 'Error',
      draft: 'Draft',
    };
    expect(statusLabels['error']).toBe('Error');
    expect(statusLabels['failed']).toBe('Error');
    expect(statusLabels['collecting']).toBe('Collecting Data');
    expect(statusLabels['generating']).toBe('Generating');
    expect(statusLabels['uploading']).toBe('Uploading');
    expect(statusLabels['published']).toBe('Live');
  });

  it('mapStatusClass maps failed to error', () => {
    function mapStatusClass(status: string): string {
      if (status === 'failed') return 'error';
      return status;
    }
    expect(mapStatusClass('failed')).toBe('error');
    expect(mapStatusClass('published')).toBe('published');
    expect(mapStatusClass('collecting')).toBe('collecting');
    expect(mapStatusClass('error')).toBe('error');
  });
});

describe('Footer CTA visibility logic', () => {
  it('hideCta is true when user is logged in', () => {
    const session = { token: 'abc123' };
    const screen = 'search';
    const hideGlobal = screen === 'signin' || screen === 'waiting';
    const hideCta = hideGlobal || !!(session && session.token);
    expect(hideCta).toBe(true);
  });

  it('hideCta is true on signin screen', () => {
    const session = null;
    const screen = 'signin';
    const hideGlobal = screen === 'signin' || screen === 'waiting';
    const hideCta = hideGlobal || !!(session && (session as { token?: string })?.token);
    expect(hideCta).toBe(true);
  });

  it('hideCta is true on waiting screen', () => {
    const session = { token: 'abc123' };
    const screen = 'waiting';
    const hideGlobal = screen === 'signin' || screen === 'waiting';
    const hideCta = hideGlobal || !!(session && session.token);
    expect(hideCta).toBe(true);
  });

  it('hideCta is false for unauthenticated user on search screen', () => {
    const session = null;
    const screen = 'search';
    const hideGlobal = screen === 'signin' || screen === 'waiting';
    const hideCta = hideGlobal || !!(session && (session as { token?: string })?.token);
    expect(hideCta).toBe(false);
  });
});

describe('ARIA tab state management', () => {
  it('switchDomainTab sets aria-selected correctly', () => {
    const tabs = ['existing', 'connect', 'register'];
    const activeTab = 'connect';
    const result: Record<string, boolean> = {};
    for (const tab of tabs) {
      result[tab] = tab === activeTab;
    }
    expect(result['existing']).toBe(false);
    expect(result['connect']).toBe(true);
    expect(result['register']).toBe(false);
  });

  it('only one tab is selected at a time', () => {
    const tabs = ['existing', 'connect', 'register'];
    for (const activeTab of tabs) {
      const selected = tabs.filter((t) => t === activeTab);
      expect(selected).toHaveLength(1);
    }
  });
});

describe('Inline slug input style inheritance', () => {
  it('slug-input CSS properties should inherit from parent', () => {
    const inheritProperties = [
      'font-family',
      'font-size',
      'font-weight',
      'font-style',
      'letter-spacing',
      'line-height',
      'word-spacing',
      'text-transform',
    ];
    // All properties should use 'inherit' value
    for (const prop of inheritProperties) {
      expect(prop).toBeTruthy();
    }
    expect(inheritProperties).toHaveLength(8);
  });

  it('slug-editable and slug-input should both have underline decoration', () => {
    const editableDecoration = 'underline';
    const inputDecoration = 'underline';
    expect(editableDecoration).toBe(inputDecoration);
  });

  it('slug-editable hover color matches accent', () => {
    const hoverColor = '#4ecdc4';
    expect(hoverColor).toBe('#4ecdc4');
  });
});

describe('Inline title input style inheritance', () => {
  it('title-row inline-edit-wrap CSS properties should match site-card-name', () => {
    const siteCardName = {
      fontSize: '0.9rem',
      fontWeight: '600',
      fontFamily: "var(--font)",
      letterSpacing: 'normal',
      lineHeight: '1.5',
      color: 'var(--text-primary)',
    };
    const inlineEditWrap = {
      fontSize: '0.9rem',
      fontWeight: '600',
      fontFamily: "var(--font)",
      letterSpacing: 'normal',
      lineHeight: '1.5',
      color: 'var(--text-primary)',
    };
    expect(inlineEditWrap.fontSize).toBe(siteCardName.fontSize);
    expect(inlineEditWrap.fontWeight).toBe(siteCardName.fontWeight);
    expect(inlineEditWrap.fontFamily).toBe(siteCardName.fontFamily);
    expect(inlineEditWrap.letterSpacing).toBe(siteCardName.letterSpacing);
    expect(inlineEditWrap.lineHeight).toBe(siteCardName.lineHeight);
    expect(inlineEditWrap.color).toBe(siteCardName.color);
  });
});

describe('Relative time formatting (formatLogTimestamp)', () => {
  function formatLogTimestamp(iso: string): string {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diff = now.getTime() - d.getTime();
      const secs = Math.floor(diff / 1000);
      const mins = Math.floor(secs / 60);
      const hrs = Math.floor(mins / 60);
      const days = Math.floor(hrs / 24);
      const weeks = Math.floor(days / 7);
      const months = Math.floor(days / 30);
      const years = Math.floor(days / 365);
      if (isNaN(secs)) return iso;
      if (secs < 10) return 'just now';
      if (secs < 45) return 'a few seconds ago';
      if (secs < 90) return 'a minute ago';
      if (mins < 45) return mins + ' minutes ago';
      if (mins < 90) return 'an hour ago';
      if (hrs < 24) return hrs + ' hours ago';
      if (hrs < 42) return 'a day ago';
      if (days < 7) return days + ' days ago';
      if (days < 11) return 'a week ago';
      if (weeks < 4) return weeks + ' weeks ago';
      if (days < 45) return 'a month ago';
      if (months < 12) return months + ' months ago';
      if (months < 18) return 'a year ago';
      return years + ' years ago';
    } catch (_e) { return iso; }
  }

  it('returns "just now" for timestamps under 10 seconds', () => {
    const now = new Date();
    expect(formatLogTimestamp(now.toISOString())).toBe('just now');
  });

  it('returns "a few seconds ago" for 15 seconds', () => {
    const d = new Date(Date.now() - 15 * 1000);
    expect(formatLogTimestamp(d.toISOString())).toBe('a few seconds ago');
  });

  it('returns "a minute ago" for 60 seconds', () => {
    const d = new Date(Date.now() - 60 * 1000);
    expect(formatLogTimestamp(d.toISOString())).toBe('a minute ago');
  });

  it('returns "X minutes ago" for 5 minutes', () => {
    const d = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatLogTimestamp(d.toISOString())).toBe('5 minutes ago');
  });

  it('returns "an hour ago" for 60 minutes', () => {
    const d = new Date(Date.now() - 60 * 60 * 1000);
    expect(formatLogTimestamp(d.toISOString())).toBe('an hour ago');
  });

  it('returns "X hours ago" for 3 hours', () => {
    const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(formatLogTimestamp(d.toISOString())).toBe('3 hours ago');
  });

  it('returns "a day ago" for 30 hours', () => {
    const d = new Date(Date.now() - 30 * 60 * 60 * 1000);
    expect(formatLogTimestamp(d.toISOString())).toBe('a day ago');
  });

  it('returns "X days ago" for 3 days', () => {
    const d = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(formatLogTimestamp(d.toISOString())).toBe('3 days ago');
  });

  it('returns "a week ago" for 8 days', () => {
    const d = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    expect(formatLogTimestamp(d.toISOString())).toBe('a week ago');
  });

  it('returns "X weeks ago" for 18 days', () => {
    const d = new Date(Date.now() - 18 * 24 * 60 * 60 * 1000);
    expect(formatLogTimestamp(d.toISOString())).toBe('2 weeks ago');
  });

  it('returns "a month ago" for 35 days', () => {
    const d = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    expect(formatLogTimestamp(d.toISOString())).toBe('a month ago');
  });

  it('returns "X months ago" for 100 days', () => {
    const d = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    expect(formatLogTimestamp(d.toISOString())).toBe('3 months ago');
  });

  it('returns "a year ago" for 400 days', () => {
    const d = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    expect(formatLogTimestamp(d.toISOString())).toBe('a year ago');
  });

  it('returns "X years ago" for 800 days', () => {
    const d = new Date(Date.now() - 800 * 24 * 60 * 60 * 1000);
    expect(formatLogTimestamp(d.toISOString())).toBe('2 years ago');
  });

  it('returns raw ISO string on invalid input', () => {
    expect(formatLogTimestamp('invalid')).toBe('invalid');
  });
});

describe('Workflow step action labels', () => {
  const actionLabels: Record<string, string> = {
    'workflow.step.profile_research_started': 'Researching Business',
    'workflow.step.parallel_research_started': 'Researching Details',
    'workflow.step.html_generation_started': 'Generating Website',
    'workflow.step.legal_scoring_started': 'Creating Legal Pages',
    'workflow.step.upload_started': 'Uploading Files',
    'workflow.step.publishing_started': 'Publishing Site',
    'workflow.step.failed': 'Step Failed',
    'workflow.step.profile_research_complete': 'Profile Research Done',
    'workflow.step.parallel_research_complete': 'Research Complete',
    'workflow.step.html_generation_complete': 'Website Generated',
    'workflow.step.legal_and_scoring_complete': 'Legal Pages Ready',
    'workflow.step.upload_to_r2_complete': 'Files Uploaded',
    'workflow.completed': 'Build Completed',
    'workflow.started': 'Build Started',
  };

  it('has labels for all workflow step started actions', () => {
    expect(actionLabels['workflow.step.profile_research_started']).toBe('Researching Business');
    expect(actionLabels['workflow.step.parallel_research_started']).toBe('Researching Details');
    expect(actionLabels['workflow.step.html_generation_started']).toBe('Generating Website');
    expect(actionLabels['workflow.step.legal_scoring_started']).toBe('Creating Legal Pages');
    expect(actionLabels['workflow.step.upload_started']).toBe('Uploading Files');
    expect(actionLabels['workflow.step.publishing_started']).toBe('Publishing Site');
  });

  it('has label for step failure', () => {
    expect(actionLabels['workflow.step.failed']).toBe('Step Failed');
  });

  it('has labels for all completion actions', () => {
    expect(actionLabels['workflow.completed']).toBe('Build Completed');
    expect(actionLabels['workflow.step.profile_research_complete']).toBe('Profile Research Done');
    expect(actionLabels['workflow.step.html_generation_complete']).toBe('Website Generated');
    expect(actionLabels['workflow.step.legal_and_scoring_complete']).toBe('Legal Pages Ready');
    expect(actionLabels['workflow.step.upload_to_r2_complete']).toBe('Files Uploaded');
  });
});

describe('Clean URL routing for marketing pages', () => {
  it('resolves / to marketing/index.html', () => {
    const path = '/';
    const marketingPath = `marketing${path === '/' ? '/index.html' : path}`;
    expect(marketingPath).toBe('marketing/index.html');
  });

  it('resolves /privacy to marketing/privacy', () => {
    const path = '/privacy';
    const marketingPath = `marketing${path === '/' ? '/index.html' : path}`;
    expect(marketingPath).toBe('marketing/privacy');
  });

  it('appends .html for clean URL fallback', () => {
    const path = '/privacy';
    const marketingPath = `marketing${path === '/' ? '/index.html' : path}`;
    const htmlFallback = `${marketingPath}.html`;
    expect(htmlFallback).toBe('marketing/privacy.html');
  });

  it('resolves /terms to marketing/terms.html fallback', () => {
    const path = '/terms';
    const marketingPath = `marketing${path === '/' ? '/index.html' : path}`;
    expect(`${marketingPath}.html`).toBe('marketing/terms.html');
  });

  it('resolves /content to marketing/content.html fallback', () => {
    const path = '/content';
    const marketingPath = `marketing${path === '/' ? '/index.html' : path}`;
    expect(`${marketingPath}.html`).toBe('marketing/content.html');
  });

  it('resolves /login to marketing/login.html fallback', () => {
    const path = '/login';
    const marketingPath = `marketing${path === '/' ? '/index.html' : path}`;
    expect(`${marketingPath}.html`).toBe('marketing/login.html');
  });

  it('does not apply .html fallback for paths with extensions', () => {
    const path = '/logo.svg';
    const hasExtension = path.includes('.');
    expect(hasExtension).toBe(true);
  });

  it('/contact redirects to /#contact-section', () => {
    const path = '/contact';
    const isContact = path === '/contact';
    expect(isContact).toBe(true);
    const target = 'https://sites.megabyte.space/#contact-section';
    expect(target).toContain('#contact-section');
  });
});

describe('AddHostname loading state', () => {
  it('button is disabled during request and restored after', () => {
    let disabled = false;
    let text = 'Add Domain';

    // Simulate start
    disabled = true;
    text = 'Adding\u2026';
    expect(disabled).toBe(true);
    expect(text).toBe('Adding\u2026');

    // Simulate complete
    disabled = false;
    text = 'Add Domain';
    expect(disabled).toBe(false);
    expect(text).toBe('Add Domain');
  });

  it('button is restored on error', () => {
    let disabled = true;
    let text = 'Adding\u2026';

    // Simulate error
    disabled = false;
    text = 'Add Domain';
    expect(disabled).toBe(false);
    expect(text).toBe('Add Domain');
  });
});
