/**
 * E2E tests for Files modal improvements:
 * - Path/breadcrumb seamlessly merged with file list
 * - Inline file rename (Rename button + click-to-rename)
 * - Path prefix display in editor
 * - Folder creation and deletion
 * - File upload capability
 * - Centered action buttons
 * - 'editable' label instead of 'Edit' badge
 */
import { test, expect } from './fixtures';

test.describe('Files Modal v2', () => {
  test('files toolbar has gradient background matching editor style', async ({ page }) => {
    await page.goto('/');
    const toolbar = page.locator('#files-toolbar');
    await expect(toolbar).toBeAttached();
    const toolbarClass = await toolbar.getAttribute('class');
    expect(toolbarClass).toContain('files-toolbar-compact');
  });

  test('files list has no border-top (seamless with toolbar)', async ({ page }) => {
    await page.goto('/');
    const filesList = page.locator('#files-list');
    await expect(filesList).toBeAttached();
    const style = await filesList.getAttribute('style');
    expect(style).toContain('border-top:none');
  });

  test('files editor has clickable filename instead of separate Rename button', async ({ page }) => {
    await page.goto('/');
    // Rename button was removed — clicking filename triggers inline rename
    const nameEl = page.locator('#files-editor-name');
    await expect(nameEl).toBeAttached();
    const title = await nameEl.getAttribute('title');
    expect(title).toContain('rename');
  });

  test('filename display is clickable to rename', async ({ page }) => {
    await page.goto('/');
    const nameEl = page.locator('#files-editor-name');
    await expect(nameEl).toBeAttached();
    const cursor = await nameEl.getAttribute('style');
    expect(cursor).toContain('cursor:pointer');
  });

  test('path prefix element exists for showing directory path', async ({ page }) => {
    await page.goto('/');
    const pathPrefix = page.locator('#files-editor-path-prefix');
    await expect(pathPrefix).toBeAttached();
  });

  test('inline rename input has styled appearance matching filename area', async ({ page }) => {
    await page.goto('/');
    const renameInput = page.locator('#files-rename-input');
    await expect(renameInput).toBeAttached();
    const style = await renameInput.getAttribute('style');
    expect(style).toContain('border-radius:4px');
    expect(style).toContain('border:1px solid');
  });

  test('rename wrap is hidden by default', async ({ page }) => {
    await page.goto('/');
    const renameWrap = page.locator('#files-rename-wrap');
    const display = await renameWrap.evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe('none');
  });

  test('page source includes folder and upload functions', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('promptNewFolder');
    expect(html).toContain('triggerFileUpload');
    expect(html).toContain('confirmDeleteFolder');
    expect(html).toContain('uploadFiles');
  });

  test('page uses editable label instead of Edit badge', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // Should use subtle 'editable' text, not a bordered 'Edit' badge
    expect(html).toContain('editable</span>');
    expect(html).not.toContain('>Edit</span>');
  });
});
