/**
 * Unit tests for the git-based snapshot service (services/git.ts).
 *
 * Tests cover: createSnapshot, getHistory, getCommit, checkoutSnapshot,
 * revertToSnapshot, diffSnapshots, getHead.
 */

import {
  createSnapshot,
  getHistory,
  getCommit,
  checkoutSnapshot,
  revertToSnapshot,
  diffSnapshots,
  getHead,
} from '../services/git.js';
import type { CommitMetadata } from '../services/git.js';

// ─── R2 Bucket Mock ─────────────────────────────────────────────

/**
 * In-memory R2 bucket mock for testing.
 * Stores objects as key → { body, httpMetadata }.
 */
function createMockBucket(): R2Bucket {
  const store = new Map<string, { body: string | ArrayBuffer; httpMetadata?: { contentType?: string } }>();

  return {
    put: jest.fn(async (key: string, body: string | ArrayBuffer | ReadableStream, options?: { httpMetadata?: { contentType?: string } }) => {
      const content = typeof body === 'string' ? body : body;
      store.set(key, { body: content as string, httpMetadata: options?.httpMetadata });
      return { key, size: typeof body === 'string' ? body.length : 0 } as unknown as R2Object;
    }),
    get: jest.fn(async (key: string) => {
      const item = store.get(key);
      if (!item) return null;
      return {
        text: async () => typeof item.body === 'string' ? item.body : '',
        json: async () => JSON.parse(typeof item.body === 'string' ? item.body : '{}'),
        arrayBuffer: async () => new TextEncoder().encode(typeof item.body === 'string' ? item.body : '').buffer,
        body: null,
        bodyUsed: false,
        key,
      } as unknown as R2ObjectBody;
    }),
    head: jest.fn(async (key: string) => {
      const item = store.get(key);
      if (!item) return null;
      return { key, size: typeof item.body === 'string' ? item.body.length : 0 } as unknown as R2Object;
    }),
    delete: jest.fn(async () => {}),
    list: jest.fn(async () => ({ objects: [], delimitedPrefixes: [], truncated: false })),
    createMultipartUpload: jest.fn(),
    resumeMultipartUpload: jest.fn(),
    // Expose store for test assertions
    _store: store,
  } as unknown as R2Bucket & { _store: Map<string, unknown> };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Git Snapshot Service', () => {
  let bucket: R2Bucket & { _store: Map<string, unknown> };

  beforeEach(() => {
    bucket = createMockBucket() as R2Bucket & { _store: Map<string, unknown> };
  });

  // ── createSnapshot ────────────────────────────────────────────

  describe('createSnapshot', () => {
    it('creates a first commit with null parentId', async () => {
      const files = [
        { name: 'index.html', content: '<html>Hello</html>' },
        { name: 'style.css', content: 'body { margin: 0; }' },
      ];

      const commitId = await createSnapshot(bucket, 'test-site', files, 'Initial commit');

      expect(commitId).toBeTruthy();
      expect(typeof commitId).toBe('string');

      // HEAD should be updated
      const headObj = await bucket.get('sites/test-site/git/HEAD');
      expect(headObj).not.toBeNull();
      const headText = await headObj!.text();
      expect(headText).toBe(commitId);

      // Commit metadata should be stored
      const commitObj = await bucket.get(`sites/test-site/git/commits/${commitId}.json`);
      expect(commitObj).not.toBeNull();
      const commit: CommitMetadata = await commitObj!.json();
      expect(commit.message).toBe('Initial commit');
      expect(commit.parentId).toBeNull();
      expect(commit.author).toBe('ProjectSites AI');
      expect(commit.files).toHaveLength(2);
      expect(commit.files[0].name).toBe('index.html');
      expect(commit.files[1].name).toBe('style.css');

      // Files should be stored in the tree
      const indexObj = await bucket.get(`sites/test-site/git/trees/${commitId}/index.html`);
      expect(indexObj).not.toBeNull();
      const indexContent = await indexObj!.text();
      expect(indexContent).toBe('<html>Hello</html>');
    });

    it('sets parentId to previous HEAD on second commit', async () => {
      const firstId = await createSnapshot(
        bucket, 'test-site',
        [{ name: 'index.html', content: 'v1' }],
        'First',
      );

      const secondId = await createSnapshot(
        bucket, 'test-site',
        [{ name: 'index.html', content: 'v2' }],
        'Second',
      );

      expect(secondId).not.toBe(firstId);

      const secondCommit = await getCommit(bucket, 'test-site', secondId);
      expect(secondCommit!.parentId).toBe(firstId);
    });

    it('uses custom author and buildVersion', async () => {
      const id = await createSnapshot(
        bucket, 'test-site',
        [{ name: 'index.html', content: 'test' }],
        'Custom commit',
        'John Doe',
        'v1705312200000',
      );

      const commit = await getCommit(bucket, 'test-site', id);
      expect(commit!.author).toBe('John Doe');
      expect(commit!.buildVersion).toBe('v1705312200000');
    });

    it('stores file sizes correctly', async () => {
      const content = 'Hello World! This is a test file.';
      const id = await createSnapshot(
        bucket, 'test-site',
        [{ name: 'test.txt', content }],
        'Size test',
      );

      const commit = await getCommit(bucket, 'test-site', id);
      expect(commit!.files[0].size).toBe(content.length);
    });
  });

  // ── getHistory ────────────────────────────────────────────────

  describe('getHistory', () => {
    it('returns empty array for site with no commits', async () => {
      const history = await getHistory(bucket, 'nonexistent-site');
      expect(history).toEqual([]);
    });

    it('returns commits in newest-first order', async () => {
      await createSnapshot(bucket, 'test-site', [{ name: 'a.html', content: 'a' }], 'First');
      await createSnapshot(bucket, 'test-site', [{ name: 'b.html', content: 'b' }], 'Second');
      await createSnapshot(bucket, 'test-site', [{ name: 'c.html', content: 'c' }], 'Third');

      const history = await getHistory(bucket, 'test-site');

      expect(history).toHaveLength(3);
      expect(history[0].message).toBe('Third');
      expect(history[1].message).toBe('Second');
      expect(history[2].message).toBe('First');
    });

    it('respects depth parameter', async () => {
      await createSnapshot(bucket, 'test-site', [{ name: 'a.html', content: 'a' }], 'First');
      await createSnapshot(bucket, 'test-site', [{ name: 'b.html', content: 'b' }], 'Second');
      await createSnapshot(bucket, 'test-site', [{ name: 'c.html', content: 'c' }], 'Third');

      const history = await getHistory(bucket, 'test-site', 2);

      expect(history).toHaveLength(2);
      expect(history[0].message).toBe('Third');
      expect(history[1].message).toBe('Second');
    });

    it('returns correct fileCount in summaries', async () => {
      await createSnapshot(
        bucket, 'test-site',
        [{ name: 'a.html', content: 'a' }, { name: 'b.css', content: 'b' }, { name: 'c.js', content: 'c' }],
        'Three files',
      );

      const history = await getHistory(bucket, 'test-site');
      expect(history[0].fileCount).toBe(3);
    });
  });

  // ── getCommit ─────────────────────────────────────────────────

  describe('getCommit', () => {
    it('returns null for nonexistent commit', async () => {
      const commit = await getCommit(bucket, 'test-site', 'nonexistent-id');
      expect(commit).toBeNull();
    });

    it('returns full commit metadata', async () => {
      const id = await createSnapshot(
        bucket, 'test-site',
        [{ name: 'index.html', content: '<html></html>' }],
        'Test commit',
        'Test Author',
      );

      const commit = await getCommit(bucket, 'test-site', id);

      expect(commit).not.toBeNull();
      expect(commit!.id).toBe(id);
      expect(commit!.message).toBe('Test commit');
      expect(commit!.author).toBe('Test Author');
      expect(commit!.timestamp).toBeTruthy();
      expect(commit!.files).toHaveLength(1);
    });
  });

  // ── checkoutSnapshot ──────────────────────────────────────────

  describe('checkoutSnapshot', () => {
    it('returns all files from a commit', async () => {
      const files = [
        { name: 'index.html', content: '<html>Page</html>' },
        { name: 'style.css', content: 'body { color: red; }' },
        { name: 'app.js', content: 'console.log("hi")' },
      ];

      const id = await createSnapshot(bucket, 'test-site', files, 'Full site');

      const result = await checkoutSnapshot(bucket, 'test-site', id);

      expect(result).toHaveLength(3);
      expect(result.find(f => f.name === 'index.html')!.content).toBe('<html>Page</html>');
      expect(result.find(f => f.name === 'style.css')!.content).toBe('body { color: red; }');
      expect(result.find(f => f.name === 'app.js')!.content).toBe('console.log("hi")');
    });

    it('throws for nonexistent commit', async () => {
      await expect(checkoutSnapshot(bucket, 'test-site', 'bad-id'))
        .rejects.toThrow('Commit not found: bad-id');
    });
  });

  // ── revertToSnapshot ──────────────────────────────────────────

  describe('revertToSnapshot', () => {
    it('creates a new commit with the old files', async () => {
      const v1Files = [{ name: 'index.html', content: 'Version 1' }];
      const v1Id = await createSnapshot(bucket, 'test-site', v1Files, 'v1');

      await createSnapshot(bucket, 'test-site', [{ name: 'index.html', content: 'Version 2' }], 'v2');
      await createSnapshot(bucket, 'test-site', [{ name: 'index.html', content: 'Version 3' }], 'v3');

      const result = await revertToSnapshot(bucket, 'test-site', v1Id);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].content).toBe('Version 1');

      // A new commit should have been created
      const history = await getHistory(bucket, 'test-site');
      expect(history).toHaveLength(4); // v1, v2, v3, revert
      expect(history[0].message).toContain('Revert to: v1');
    });

    it('throws for empty commit', async () => {
      // Create a commit with a file, but mock the checkout to return empty
      const id = await createSnapshot(bucket, 'test-site', [{ name: 'test.html', content: 'test' }], 'test');

      // Remove the tree file to simulate empty checkout
      (bucket as unknown as { _store: Map<string, unknown> })._store.delete(`sites/test-site/git/trees/${id}/test.html`);

      await expect(revertToSnapshot(bucket, 'test-site', id))
        .rejects.toThrow('No files found in commit');
    });
  });

  // ── diffSnapshots ─────────────────────────────────────────────

  describe('diffSnapshots', () => {
    it('detects added files', async () => {
      const baseId = await createSnapshot(
        bucket, 'test-site',
        [{ name: 'index.html', content: 'base' }],
        'Base',
      );

      const targetId = await createSnapshot(
        bucket, 'test-site',
        [{ name: 'index.html', content: 'base' }, { name: 'new.css', content: 'new' }],
        'Added file',
      );

      const diff = await diffSnapshots(bucket, 'test-site', baseId, targetId);

      expect(diff.added).toContain('new.css');
      expect(diff.unchanged).toContain('index.html');
      expect(diff.removed).toHaveLength(0);
      expect(diff.modified).toHaveLength(0);
    });

    it('detects removed files', async () => {
      const baseId = await createSnapshot(
        bucket, 'test-site',
        [{ name: 'index.html', content: 'base' }, { name: 'old.css', content: 'old' }],
        'Base',
      );

      const targetId = await createSnapshot(
        bucket, 'test-site',
        [{ name: 'index.html', content: 'base' }],
        'Removed file',
      );

      const diff = await diffSnapshots(bucket, 'test-site', baseId, targetId);

      expect(diff.removed).toContain('old.css');
      expect(diff.unchanged).toContain('index.html');
      expect(diff.added).toHaveLength(0);
    });

    it('detects modified files', async () => {
      const baseId = await createSnapshot(
        bucket, 'test-site',
        [{ name: 'index.html', content: 'old content' }],
        'Base',
      );

      const targetId = await createSnapshot(
        bucket, 'test-site',
        [{ name: 'index.html', content: 'new content' }],
        'Modified',
      );

      const diff = await diffSnapshots(bucket, 'test-site', baseId, targetId);

      expect(diff.modified).toContain('index.html');
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.unchanged).toHaveLength(0);
    });

    it('handles complex diffs with all change types', async () => {
      const baseId = await createSnapshot(
        bucket, 'test-site',
        [
          { name: 'keep.html', content: 'same' },
          { name: 'change.css', content: 'old' },
          { name: 'delete.js', content: 'gone' },
        ],
        'Base',
      );

      const targetId = await createSnapshot(
        bucket, 'test-site',
        [
          { name: 'keep.html', content: 'same' },
          { name: 'change.css', content: 'new' },
          { name: 'add.txt', content: 'fresh' },
        ],
        'Complex change',
      );

      const diff = await diffSnapshots(bucket, 'test-site', baseId, targetId);

      expect(diff.unchanged).toEqual(['keep.html']);
      expect(diff.modified).toEqual(['change.css']);
      expect(diff.added).toEqual(['add.txt']);
      expect(diff.removed).toEqual(['delete.js']);
    });
  });

  // ── getHead ───────────────────────────────────────────────────

  describe('getHead', () => {
    it('returns null for site with no commits', async () => {
      const head = await getHead(bucket, 'nonexistent');
      expect(head).toBeNull();
    });

    it('returns latest commit ID', async () => {
      await createSnapshot(bucket, 'test-site', [{ name: 'a.html', content: 'a' }], 'First');
      const secondId = await createSnapshot(bucket, 'test-site', [{ name: 'b.html', content: 'b' }], 'Second');

      const head = await getHead(bucket, 'test-site');
      expect(head).toBe(secondId);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles sites with special characters in slug', async () => {
      const id = await createSnapshot(
        bucket, 'my-cool-site-123',
        [{ name: 'index.html', content: 'test' }],
        'Test',
      );

      const history = await getHistory(bucket, 'my-cool-site-123');
      expect(history).toHaveLength(1);
      expect(history[0].sha).toBe(id);
    });

    it('handles files with nested paths', async () => {
      const files = [
        { name: 'index.html', content: 'root' },
        { name: 'assets/style.css', content: 'css' },
        { name: 'assets/images/logo.svg', content: '<svg/>' },
      ];

      const id = await createSnapshot(bucket, 'test-site', files, 'Nested files');
      const result = await checkoutSnapshot(bucket, 'test-site', id);

      expect(result).toHaveLength(3);
      expect(result.find(f => f.name === 'assets/images/logo.svg')!.content).toBe('<svg/>');
    });

    it('handles empty message', async () => {
      const id = await createSnapshot(
        bucket, 'test-site',
        [{ name: 'index.html', content: 'test' }],
        '',
      );

      const commit = await getCommit(bucket, 'test-site', id);
      expect(commit!.message).toBe('');
    });

    it('handles large number of files', async () => {
      const files = Array.from({ length: 50 }, (_, i) => ({
        name: `file-${i}.html`,
        content: `Content for file ${i}`,
      }));

      const id = await createSnapshot(bucket, 'test-site', files, 'Many files');

      const commit = await getCommit(bucket, 'test-site', id);
      expect(commit!.files).toHaveLength(50);

      const result = await checkoutSnapshot(bucket, 'test-site', id);
      expect(result).toHaveLength(50);
    });
  });
});
