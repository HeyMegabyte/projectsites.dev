/**
 * External asset migration — stub implementation.
 *
 * @remarks
 * Walks a published site's R2 directory, finds external `src=`/`href=`/`url(...)`
 * references, downloads them to R2, rewrites HTML/CSS to use the self-hosted
 * copies. Currently a no-op stub so the worker compiles; full implementation
 * lives behind the admin migrate-assets route.
 */
export interface MigrationReport {
  scanned_files: number;
  unique_urls: number;
  uploaded: number;
  rewritten_files: number;
  failed: Array<{ url: string; reason: string }>;
}

export async function migrateExternalAssets(
  _bucket: R2Bucket,
  _slug: string,
  _version: string,
): Promise<MigrationReport> {
  return {
    scanned_files: 0,
    unique_urls: 0,
    uploaded: 0,
    rewritten_files: 0,
    failed: [],
  };
}
