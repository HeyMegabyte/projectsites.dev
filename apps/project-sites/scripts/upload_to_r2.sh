#!/usr/bin/env bash
# Sync the r2-sync/ folder to R2 bucket.
#
# Usage:
#   ./scripts/upload_to_r2.sh [staging|production]
#
# The r2-sync/ folder mirrors the R2 bucket structure:
#   r2-sync/
#     marketing/index.html         → marketing homepage (sites.megabyte.space)
#     sites/{slug}/{version}/...   → customer sites ({slug}-sites.megabyte.space)
#
# Prerequisites:
#   - wrangler authenticated (CLOUDFLARE_API_TOKEN or `wrangler login`)
#   - R2 buckets created

set -euo pipefail

ENVIRONMENT="${1:-staging}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SYNC_DIR="$PROJECT_DIR/r2-sync"

# Map environment to bucket name
case "$ENVIRONMENT" in
  production) BUCKET="project-sites-production" ;;
  staging)    BUCKET="project-sites-staging" ;;
  *)          BUCKET="project-sites" ;;
esac

echo "=== Project Sites R2 Sync ==="
echo "Environment: $ENVIRONMENT"
echo "Bucket:      $BUCKET"
echo "Source:      $SYNC_DIR"
echo ""

if [ ! -d "$SYNC_DIR" ]; then
  echo "ERROR: r2-sync/ directory not found at $SYNC_DIR"
  exit 1
fi

# Walk the sync directory and upload each file
UPLOADED=0
while IFS= read -r -d '' file; do
  # Get the relative path from the sync dir
  rel_path="${file#$SYNC_DIR/}"

  # Determine content type from extension
  ext="${file##*.}"
  case "$ext" in
    html) content_type="text/html" ;;
    css)  content_type="text/css" ;;
    js)   content_type="application/javascript" ;;
    json) content_type="application/json" ;;
    png)  content_type="image/png" ;;
    jpg|jpeg) content_type="image/jpeg" ;;
    gif)  content_type="image/gif" ;;
    svg)  content_type="image/svg+xml" ;;
    ico)  content_type="image/x-icon" ;;
    webp) content_type="image/webp" ;;
    woff) content_type="font/woff" ;;
    woff2) content_type="font/woff2" ;;
    ttf)  content_type="font/ttf" ;;
    xml)  content_type="application/xml" ;;
    txt)  content_type="text/plain" ;;
    webmanifest) content_type="application/manifest+json" ;;
    *)    content_type="application/octet-stream" ;;
  esac

  echo "  ▸ $rel_path ($content_type)"
  npx wrangler r2 object put "$BUCKET/$rel_path" \
    --file "$file" \
    --content-type "$content_type" \
    --remote

  UPLOADED=$((UPLOADED + 1))
done < <(find "$SYNC_DIR" -type f -print0)

echo ""
echo "=== Sync Complete ==="
echo "Uploaded $UPLOADED files to $BUCKET"
echo ""
echo "Marketing homepage:  https://sites.megabyte.space/"
echo "Demo site:           https://bella-cucina-sites.megabyte.space/"
