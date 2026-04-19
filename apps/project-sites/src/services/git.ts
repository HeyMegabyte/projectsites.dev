/**
 * @module services/git
 * @description Git-like snapshot system backed by R2 object storage.
 *
 * Implements a simplified git-style version control for site files using R2.
 * Each site gets a commit history stored as JSON metadata in R2, with file
 * contents stored per-commit. This provides version history, diffing, and
 * revert capabilities without requiring a real git implementation.
 *
 * ## R2 Layout
 *
 * ```
 * sites/{slug}/git/HEAD              → current commit ID (plain text)
 * sites/{slug}/git/commits/{id}.json → commit metadata (parent, message, author, file list)
 * sites/{slug}/git/trees/{id}/       → file contents for that commit
 * ```
 *
 * ## Design Decisions
 *
 * - **JSON over isomorphic-git**: isomorphic-git requires Node.js `fs` semantics
 *   that don't map cleanly to R2's object store API in Cloudflare Workers.
 *   The JSON approach is simpler, more reliable, and sufficient for our needs.
 * - **Full snapshots, not diffs**: Each commit stores a complete copy of all files.
 *   This trades storage for simplicity and fast checkout (no need to reconstruct
 *   from a chain of diffs).
 * - **Integrates with existing R2 versioned paths**: The git system stores its own
 *   data alongside the existing `sites/{slug}/{version}/` paths. A commit can
 *   optionally reference the R2 version path it corresponds to.
 *
 * @remarks
 * This module is designed for the Cloudflare Workers runtime. All operations
 * are async and use the R2 bucket binding from the worker environment.
 *
 * @example
 * ```ts
 * import { createSnapshot, getHistory, checkoutSnapshot } from '../services/git.js';
 *
 * // Create a snapshot after publishing
 * const commitId = await createSnapshot(bucket, 'my-site', files, 'Initial publish');
 *
 * // List history
 * const history = await getHistory(bucket, 'my-site');
 *
 * // Revert to a previous snapshot
 * const files = await checkoutSnapshot(bucket, 'my-site', commitId);
 * ```
 *
 * @packageDocumentation
 */

/**
 * Metadata stored for each commit/snapshot.
 *
 * @remarks
 * Stored as JSON at `sites/{slug}/git/commits/{id}.json` in R2.
 *
 * @example
 * ```ts
 * const commit: CommitMetadata = {
 *   id: 'abc-123',
 *   message: 'Initial publish',
 *   timestamp: '2025-01-15T10:30:00.000Z',
 *   author: 'ProjectSites AI',
 *   parentId: null,
 *   buildVersion: 'v1705312200000',
 *   files: [{ name: 'index.html', size: 4096 }],
 * };
 * ```
 */
export interface CommitMetadata {
  /** Unique commit identifier (UUID). */
  id: string;
  /** Human-readable commit message describing the change. */
  message: string;
  /** ISO 8601 timestamp of when the commit was created. */
  timestamp: string;
  /** Name of the author who created this commit. */
  author: string;
  /** ID of the parent commit, or `null` for the initial commit. */
  parentId: string | null;
  /** Optional reference to the R2 build version path this commit corresponds to. */
  buildVersion?: string;
  /** List of files in this commit with their sizes. */
  files: Array<{ name: string; size: number }>;
}

/**
 * Summary of a commit for list/history views.
 *
 * @remarks
 * Returned by {@link getHistory}. Contains only the metadata needed for
 * displaying commit history in the UI, without the full file contents.
 *
 * @example
 * ```ts
 * const history = await getHistory(bucket, 'my-site');
 * for (const entry of history) {
 *   console.warn(`${entry.sha} - ${entry.message} (${entry.date})`);
 * }
 * ```
 */
export interface CommitSummary {
  /** Commit ID (maps to {@link CommitMetadata.id}). */
  sha: string;
  /** Commit message. */
  message: string;
  /** ISO 8601 timestamp. */
  date: string;
  /** Author name. */
  author: string;
  /** Number of files in this commit. */
  fileCount: number;
  /** Optional R2 build version reference. */
  buildVersion?: string;
}

/**
 * A file with its name and text content.
 *
 * @remarks
 * Used for both input (committing files) and output (checking out a snapshot).
 */
export interface GitFile {
  /** Relative file path (e.g., `index.html`, `assets/style.css`). */
  name: string;
  /** Text content of the file. */
  content: string;
}

/**
 * Result of comparing two snapshots.
 *
 * @remarks
 * Returned by {@link diffSnapshots}. Lists files that were added, removed,
 * or modified between two commits.
 */
export interface DiffResult {
  /** Files present in the target but not in the base commit. */
  added: string[];
  /** Files present in the base but not in the target commit. */
  removed: string[];
  /** Files present in both but with different content. */
  modified: string[];
  /** Files present in both with identical content. */
  unchanged: string[];
}

/**
 * Build the R2 key prefix for a site's git data.
 *
 * @param slug - The site slug.
 * @returns The R2 prefix string (e.g., `sites/my-site/git/`).
 *
 * @example
 * ```ts
 * gitPrefix('my-site'); // 'sites/my-site/git/'
 * ```
 */
function gitPrefix(slug: string): string {
  return `sites/${slug}/git/`;
}

/**
 * Create a new snapshot (commit) of site files in R2.
 *
 * Stores file contents under `sites/{slug}/git/trees/{id}/` and commit
 * metadata at `sites/{slug}/git/commits/{id}.json`. Updates HEAD to point
 * to the new commit.
 *
 * @param bucket - R2 bucket binding.
 * @param slug - Site slug.
 * @param files - Array of files to commit.
 * @param message - Commit message describing the change.
 * @param author - Author name (defaults to `'ProjectSites AI'`).
 * @param buildVersion - Optional R2 build version this commit corresponds to.
 * @returns The commit ID (UUID).
 *
 * @throws {Error} If R2 operations fail.
 *
 * @example
 * ```ts
 * const id = await createSnapshot(bucket, 'my-site', [
 *   { name: 'index.html', content: '<html>...</html>' },
 * ], 'Initial publish', 'AI', 'v1705312200000');
 * ```
 *
 * @see {@link getHistory} to list commits
 * @see {@link checkoutSnapshot} to restore files from a commit
 */
export async function createSnapshot(
  bucket: R2Bucket,
  slug: string,
  files: GitFile[],
  message: string,
  author: string = 'ProjectSites AI',
  buildVersion?: string,
): Promise<string> {
  const prefix = gitPrefix(slug);
  const id = crypto.randomUUID();

  // Read current HEAD to set as parent
  let parentId: string | null = null;
  try {
    const headObj = await bucket.get(`${prefix}HEAD`);
    if (headObj) {
      parentId = (await headObj.text()).trim() || null;
    }
  } catch {
    // No HEAD yet — this is the first commit
  }

  // Build commit metadata
  const commit: CommitMetadata = {
    id,
    message,
    timestamp: new Date().toISOString(),
    author,
    parentId,
    buildVersion,
    files: files.map((f) => ({ name: f.name, size: f.content.length })),
  };

  // Store file contents
  const uploads: Promise<R2Object>[] = [];
  for (const f of files) {
    uploads.push(
      bucket.put(`${prefix}trees/${id}/${f.name}`, f.content, {
        httpMetadata: { contentType: guessContentType(f.name) },
      }),
    );
  }
  await Promise.all(uploads);

  // Store commit metadata
  await bucket.put(
    `${prefix}commits/${id}.json`,
    JSON.stringify(commit, null, 2),
    { httpMetadata: { contentType: 'application/json' } },
  );

  // Update HEAD
  await bucket.put(`${prefix}HEAD`, id);

  return id;
}

/**
 * Get commit history for a site, walking the parent chain from HEAD.
 *
 * @param bucket - R2 bucket binding.
 * @param slug - Site slug.
 * @param depth - Maximum number of commits to return (defaults to 20).
 * @returns Array of commit summaries, newest first.
 *
 * @remarks
 * Walks the parent chain starting from HEAD. If a commit's metadata
 * cannot be read (e.g., corrupted or deleted), the chain stops.
 *
 * @example
 * ```ts
 * const history = await getHistory(bucket, 'my-site', 10);
 * // [{ sha: 'abc', message: 'Latest', date: '...', author: '...' }, ...]
 * ```
 *
 * @see {@link createSnapshot} to add commits
 * @see {@link checkoutSnapshot} to restore a specific commit
 */
export async function getHistory(
  bucket: R2Bucket,
  slug: string,
  depth: number = 20,
): Promise<CommitSummary[]> {
  const prefix = gitPrefix(slug);
  const history: CommitSummary[] = [];

  // Read HEAD
  let currentId: string | null = null;
  try {
    const headObj = await bucket.get(`${prefix}HEAD`);
    if (headObj) {
      currentId = (await headObj.text()).trim() || null;
    }
  } catch {
    return [];
  }

  if (!currentId) return [];

  // Walk the parent chain
  let remaining = depth;
  while (currentId && remaining > 0) {
    try {
      const commitObj = await bucket.get(`${prefix}commits/${currentId}.json`);
      if (!commitObj) break;

      const commit: CommitMetadata = await commitObj.json();
      history.push({
        sha: commit.id,
        message: commit.message,
        date: commit.timestamp,
        author: commit.author,
        fileCount: commit.files.length,
        buildVersion: commit.buildVersion,
      });

      currentId = commit.parentId;
      remaining--;
    } catch {
      break;
    }
  }

  return history;
}

/**
 * Retrieve the metadata for a specific commit.
 *
 * @param bucket - R2 bucket binding.
 * @param slug - Site slug.
 * @param commitId - The commit ID to look up.
 * @returns The commit metadata, or `null` if not found.
 *
 * @example
 * ```ts
 * const commit = await getCommit(bucket, 'my-site', 'abc-123');
 * if (commit) {
 *   console.warn(`Commit: ${commit.message} (${commit.files.length} files)`);
 * }
 * ```
 *
 * @see {@link getHistory} for listing multiple commits
 */
export async function getCommit(
  bucket: R2Bucket,
  slug: string,
  commitId: string,
): Promise<CommitMetadata | null> {
  const prefix = gitPrefix(slug);
  try {
    const obj = await bucket.get(`${prefix}commits/${commitId}.json`);
    if (!obj) return null;
    return await obj.json();
  } catch {
    return null;
  }
}

/**
 * Checkout (restore) all files from a specific commit.
 *
 * Reads all files stored in the commit's tree and returns them as an array
 * of `GitFile` objects. Does NOT modify HEAD — use {@link revertToSnapshot}
 * to also update HEAD and create a revert commit.
 *
 * @param bucket - R2 bucket binding.
 * @param slug - Site slug.
 * @param commitId - The commit ID to checkout.
 * @returns Array of files with their contents.
 *
 * @throws {Error} If the commit does not exist.
 *
 * @example
 * ```ts
 * const files = await checkoutSnapshot(bucket, 'my-site', 'abc-123');
 * for (const f of files) {
 *   console.warn(`${f.name}: ${f.content.length} bytes`);
 * }
 * ```
 *
 * @see {@link revertToSnapshot} to checkout AND create a revert commit
 */
export async function checkoutSnapshot(
  bucket: R2Bucket,
  slug: string,
  commitId: string,
): Promise<GitFile[]> {
  const prefix = gitPrefix(slug);

  // Get commit metadata to know which files to read
  const commit = await getCommit(bucket, slug, commitId);
  if (!commit) {
    throw new Error(`Commit not found: ${commitId}`);
  }

  // Read all files in parallel
  const filePromises = commit.files.map(async (f) => {
    try {
      const obj = await bucket.get(`${prefix}trees/${commitId}/${f.name}`);
      if (!obj) return null;
      const content = await obj.text();
      return { name: f.name, content };
    } catch {
      return null;
    }
  });

  const results = await Promise.all(filePromises);
  return results.filter((f): f is GitFile => f !== null);
}

/**
 * Revert a site to a previous snapshot by checking out its files and
 * creating a new commit that records the revert.
 *
 * This is the primary "undo" operation:
 * 1. Reads all files from the target commit.
 * 2. Creates a new commit with those files and a revert message.
 * 3. Updates HEAD to the new commit.
 *
 * @param bucket - R2 bucket binding.
 * @param slug - Site slug.
 * @param commitId - The commit ID to revert to.
 * @param author - Author name for the revert commit.
 * @returns Object with the new commit ID and the restored files.
 *
 * @throws {Error} If the target commit does not exist or has no files.
 *
 * @example
 * ```ts
 * const result = await revertToSnapshot(bucket, 'my-site', 'abc-123');
 * console.warn(`Reverted to ${result.commitId}, ${result.files.length} files restored`);
 * ```
 *
 * @see {@link checkoutSnapshot} to read files without creating a new commit
 * @see {@link getHistory} to find the commit ID to revert to
 */
export async function revertToSnapshot(
  bucket: R2Bucket,
  slug: string,
  commitId: string,
  author: string = 'ProjectSites AI',
): Promise<{ commitId: string; files: GitFile[] }> {
  // Checkout the target commit's files
  const files = await checkoutSnapshot(bucket, slug, commitId);

  if (files.length === 0) {
    throw new Error(`No files found in commit: ${commitId}`);
  }

  // Get the original commit's message for the revert message
  const originalCommit = await getCommit(bucket, slug, commitId);
  const originalMessage = originalCommit?.message ?? 'unknown';

  // Create a new commit with the reverted files
  const newCommitId = await createSnapshot(
    bucket,
    slug,
    files,
    `Revert to: ${originalMessage} (${commitId.substring(0, 8)})`,
    author,
    originalCommit?.buildVersion,
  );

  return { commitId: newCommitId, files };
}

/**
 * Compare two snapshots and return a diff summary.
 *
 * Compares file lists and contents between two commits to determine
 * which files were added, removed, modified, or unchanged.
 *
 * @param bucket - R2 bucket binding.
 * @param slug - Site slug.
 * @param baseCommitId - The base (older) commit ID.
 * @param targetCommitId - The target (newer) commit ID.
 * @returns A {@link DiffResult} summarizing the differences.
 *
 * @throws {Error} If either commit does not exist.
 *
 * @example
 * ```ts
 * const diff = await diffSnapshots(bucket, 'my-site', 'commit-a', 'commit-b');
 * console.warn(`Added: ${diff.added.length}, Modified: ${diff.modified.length}`);
 * ```
 *
 * @see {@link getHistory} to find commit IDs
 */
export async function diffSnapshots(
  bucket: R2Bucket,
  slug: string,
  baseCommitId: string,
  targetCommitId: string,
): Promise<DiffResult> {
  const [baseFiles, targetFiles] = await Promise.all([
    checkoutSnapshot(bucket, slug, baseCommitId),
    checkoutSnapshot(bucket, slug, targetCommitId),
  ]);

  const baseMap = new Map(baseFiles.map((f) => [f.name, f.content]));
  const targetMap = new Map(targetFiles.map((f) => [f.name, f.content]));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  const unchanged: string[] = [];

  // Check target files against base
  for (const [name, content] of targetMap) {
    const baseContent = baseMap.get(name);
    if (baseContent === undefined) {
      added.push(name);
    } else if (baseContent !== content) {
      modified.push(name);
    } else {
      unchanged.push(name);
    }
  }

  // Check for removed files
  for (const name of baseMap.keys()) {
    if (!targetMap.has(name)) {
      removed.push(name);
    }
  }

  return { added, removed, modified, unchanged };
}

/**
 * Get the current HEAD commit ID for a site.
 *
 * @param bucket - R2 bucket binding.
 * @param slug - Site slug.
 * @returns The current HEAD commit ID, or `null` if no commits exist.
 *
 * @example
 * ```ts
 * const head = await getHead(bucket, 'my-site');
 * if (head) {
 *   console.warn(`Current HEAD: ${head}`);
 * }
 * ```
 */
export async function getHead(
  bucket: R2Bucket,
  slug: string,
): Promise<string | null> {
  try {
    const obj = await bucket.get(`${gitPrefix(slug)}HEAD`);
    if (!obj) return null;
    const text = (await obj.text()).trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Guess MIME content type from a file extension.
 *
 * @param filename - The filename to inspect.
 * @returns The guessed MIME type, defaulting to `application/octet-stream`.
 *
 * @remarks
 * Covers common web file types. Used internally when storing files in R2.
 *
 * @example
 * ```ts
 * guessContentType('style.css');   // 'text/css'
 * guessContentType('app.js');      // 'application/javascript'
 * guessContentType('unknown.xyz'); // 'application/octet-stream'
 * ```
 */
function guessContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    mjs: 'application/javascript',
    json: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    ico: 'image/x-icon',
    txt: 'text/plain',
    xml: 'text/xml',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ts: 'application/typescript',
    tsx: 'application/typescript',
    jsx: 'application/javascript',
    md: 'text/markdown',
    yaml: 'text/yaml',
    yml: 'text/yaml',
  };
  return types[ext ?? ''] ?? 'application/octet-stream';
}
