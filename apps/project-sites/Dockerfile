FROM node:22-slim

# System deps (curl for API calls, git for repos)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Claude Code CLI
RUN npm i -g @anthropic-ai/claude-code

# Non-root user for Claude Code (requires --dangerously-skip-permissions as non-root)
RUN useradd -m cuser

# Clone skills + template repos into cuser's home
RUN git clone --depth 1 https://github.com/megabytespace/claude-skills /home/cuser/.agentskills && \
    git clone --depth 1 https://github.com/HeyMegabyte/template.projectsites.dev /home/cuser/template

# Pre-install template deps so npm install is near-instant during builds
RUN cd /home/cuser/template && npm install --legacy-peer-deps 2>/dev/null || true

# GPT-4o inspection script (called during build for design critique)
COPY scripts/inspect.js /home/cuser/inspect.js

# R2 upload script (uploads built files to Cloudflare R2 after build)
COPY scripts/upload-to-r2.mjs /home/cuser/upload-to-r2.mjs

# Set up CLAUDE.md for cuser — references skills for full methodology
RUN mkdir -p /home/cuser/.claude && \
    printf '# ProjectSites Build Agent\n\n## Skills\nRead ~/.agentskills/15-site-generation/ for COMPLETE build methodology.\nLoad via ~/.agentskills/_router.md — skill 15 covers: research pipeline, media acquisition, build prompts, quality gates, domain features, template system.\n\n## Template\nProject at ~/template/ — Vite+React+Tailwind+shadcn/ui starter.\nCopy template files first, then customize with business-specific content from _ prefixed context files.\n\n## Context Files\nAll _ prefixed files contain pre-researched data. Read ALL of them before building:\n_research.json, _brand.json, _scraped_content.json, _assets.json, _image_profiles.json, _videos.json, _places.json, _form_data.json, _domain_features.json\n\n## Build Loop\n1. Read all context files\n2. Customize template with real content, brand colors, images\n3. npm run build — fix errors\n4. node /home/cuser/inspect.js dist/index.html — fix issues scoring <8\n5. Rebuild and re-inspect (max 3 iterations)\n\n## Post-Build\nAfter successful build: node /home/cuser/upload-to-r2.mjs\nThis uploads dist/ to R2. Requires: CF_API_TOKEN, CF_ACCOUNT_ID, R2_BUCKET_NAME, SITE_SLUG, SITE_VERSION env vars.\n\n## Stack\nVite + React 18 + Tailwind CSS 3 + shadcn/ui + react-router-dom. TypeScript. Lucide React icons.\n\n## Quality Bar\nStripe/Linear/Vercel-level polish. 10+ animations. 15+ images. WCAG AA. 375px + 1280px responsive. Zero errors.\n' > /home/cuser/.claude/CLAUDE.md && \
    chown -R cuser:cuser /home/cuser

EXPOSE 8080
