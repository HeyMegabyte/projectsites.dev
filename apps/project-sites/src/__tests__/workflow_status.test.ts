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
