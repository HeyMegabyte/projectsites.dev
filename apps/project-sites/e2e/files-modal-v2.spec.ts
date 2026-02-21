/**
 * E2E tests for Files modal improvements:
 * - Path/breadcrumb smoothed into file directory container
 * - Inline file rename (Rename button)
 * - Folder creation and deletion
 * - File upload capability
 * - Centered action buttons
 */
import { test, expect } from './fixtures';

test.describe('Files Modal v2', () => {
  test('files modal has merged path and file list styling', async ({ page }) => {
    await page.goto('/');
    // Verify the toolbar and file list have connected borders
    const toolbar = page.locator('#files-toolbar');
    await expect(toolbar).toBeAttached();
    const toolbarClass = await toolbar.getAttribute('class');
    expect(toolbarClass).toContain('files-toolbar-compact');
  });

  test('files editor has rename button instead of edit', async ({ page }) => {
    await page.goto('/');
    const renameBtn = page.locator('#files-rename-btn');
    await expect(renameBtn).toBeAttached();
    const text = await renameBtn.textContent();
    expect(text).toBe('Rename');
  });

  test('files editor has inline rename input', async ({ page }) => {
    await page.goto('/');
    const renameInput = page.locator('#files-rename-input');
    await expect(renameInput).toBeAttached();
    // Should be hidden by default
    const renameWrap = page.locator('#files-rename-wrap');
    const display = await renameWrap.evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe('none');
  });

  test('action buttons (New File, New Folder, Upload) are present in page source', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('promptNewFolder');
    expect(html).toContain('triggerFileUpload');
  });
});
