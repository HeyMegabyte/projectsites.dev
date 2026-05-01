FROM node:22-slim

# System deps — full build/media tooling pre-installed so AI-generated builds
# never have to apt-get during a job. One layer + cleanup keeps the image lean.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl wget jq unzip zip xz-utils \
      build-essential pkg-config python3 python3-pip python3-venv \
      ffmpeg imagemagick libvips-tools \
      optipng jpegoptim webp \
      fonts-dejavu-core fonts-liberation \
      openssh-client gnupg \
    && rm -rf /var/lib/apt/lists/*

# CLI tooling: Claude Code + common JS helpers used during builds (sharp for image
# processing, vite for ad-hoc builds, typescript for tsc, esbuild as a fast bundler).
RUN npm i -g \
      @anthropic-ai/claude-code \
      sharp-cli \
      svgo \
      vite \
      typescript \
      tsx \
      esbuild

# Common Python helpers for image/text processing during builds.
RUN pip3 install --no-cache-dir --break-system-packages \
      pillow requests beautifulsoup4 lxml pyyaml

# Non-root user for Claude Code (requires --dangerously-skip-permissions as non-root)
RUN useradd -m cuser

# Clone skills + template repos into cuser's home
RUN git clone --depth 1 https://github.com/megabytespace/claude-skills /home/cuser/.agentskills && \
    git clone --depth 1 https://github.com/HeyMegabyte/template.projectsites.dev /home/cuser/template

# Allow root (container-server.mjs runs as root) to fetch/pull cuser-owned repos.
# Without this, git refuses with "dubious ownership" and the boot refresh of
# claude-skills + template silently fails — leaving sites stuck on stale prompts.
RUN git config --system --add safe.directory /home/cuser/.agentskills && \
    git config --system --add safe.directory /home/cuser/template

# Pre-install template deps so npm install is near-instant during builds
RUN cd /home/cuser/template && npm install --legacy-peer-deps 2>/dev/null || true

# GPT-4o inspection script (called during build for design critique)
COPY scripts/inspect.js /home/cuser/inspect.js

# R2 upload script (uploads built files to Cloudflare R2 after build)
COPY scripts/upload-to-r2.mjs /home/cuser/upload-to-r2.mjs

# Container HTTP server with disk-persisted job state (survives container restart)
COPY scripts/container-server.mjs /home/cuser/container-server.mjs

# Validator runner + the validator module it imports. Lets the validator-fixer
# subagent invoke build_validators.ts without compiling TypeScript inside the
# build dir (tsx handles the .ts import at runtime).
COPY scripts/run-validators.mjs /home/cuser/run-validators.mjs
COPY src/services/build_validators.ts /home/cuser/build_validators.ts

# Sync universal agents (visual-qa, performance-profiler, completeness-checker,
# seo-auditor, accessibility-auditor, content-writer, security-reviewer, test-writer,
# etc.) from ~/.agentskills/agents/ to ~/.claude/agents/ so the orchestrator can
# spawn them via Task tool. Then layer project-specific agents on top.
RUN mkdir -p /home/cuser/.claude/agents && \
    if [ -d /home/cuser/.agentskills/agents ]; then \
      cp /home/cuser/.agentskills/agents/*.md /home/cuser/.claude/agents/ 2>/dev/null || true; \
    fi
COPY .claude/agents/ /home/cuser/.claude/agents/

# Project-local learned rules accumulated from per-build retrospectives. Mounted
# at the standard skill path so the orchestrator picks them up via @-import in
# CLAUDE.md. Refreshed at image rebuild time only — runtime updates flow via the
# benchmark + retrospective loop writing to R2/D1, then PR-merged into the repo.
COPY .claude/skills/learned/ /home/cuser/.claude/skills/learned/

# Job state directory (persists across container hibernation)
RUN mkdir -p /var/jobs && chmod 755 /var/jobs

# Set up CLAUDE.md for cuser. Inherits the upstream CLAUDE.md from
# megabytespace/claude-skills (cloned at ~/.agentskills) via @-import, then
# layers project-specific orchestrator instructions on top. The same applies
# for AGENTS.md, _router.md, and platform meta files — projectsites inherits
# the entire claude-skills meta surface so changes upstream propagate via the
# 10-minute git-pull refresh in container-server.mjs.
RUN mkdir -p /home/cuser/.claude && \
    printf '@~/.agentskills/CLAUDE.md\n@~/.agentskills/AGENTS.md\n@~/.agentskills/_router.md\n@~/.claude/skills/learned/RULES.md\n\n# ProjectSites Build Orchestrator (overlay)\n\nThe block above pulls the full Emdash Skills v7.2 system (15 categories, 18 agents, 32 platform variants) from megabytespace/claude-skills. ProjectSites inherits ALL of it — skills, agents, conventions, profiles. The instructions below add project-specific orchestrator behavior on top of that base.\n\nYou are the build ORCHESTRATOR. You do not write components yourself — you delegate to specialist subagents in parallel via the Task tool, then route their findings to fix-capable specialists.\n\n## Inherited Skills\nFollow `~/.agentskills/_router.md` to load the smallest useful skill subset. For site generation always include `15-site-generation` (research pipeline, media acquisition, build prompts, quality gates, domain features, template system). Profile: SaaS Application (skill 15 + 06 + 07 + 08 + 09 + 10 + 12).\n\n## Template & Context\nTemplate: ~/template/ (Vite + React 18 + Tailwind 3 + shadcn/ui + react-router-dom + TypeScript + Lucide). Copy first, customize from _-prefixed JSON.\nContext files (read ALL before delegating): _research.json, _brand.json, _scraped_content.json, _assets.json, _image_profiles.json, _videos.json, _places.json, _form_data.json, _domain_features.json, _citations.json.\n\n## Available Subagents\nUniversal (synced from ~/.agentskills/agents/ at boot — re-synced every 10min):\n- visual-qa — screenshots 6 breakpoints + AI vision, audit-only.\n- performance-profiler — Lighthouse, CWV, bundle budgets, audit-only.\n- completeness-checker — Zero Recommendations Gate, final ship verdict.\n- seo-auditor — title/meta/H1/JSON-LD/OG/sitemap, audit-only.\n- accessibility-auditor — axe-core WCAG 2.2 AA at 6 breakpoints, audit-only.\n- content-writer — Emdash brand voice copy, Flesch >= 60.\n- security-reviewer — OWASP audit, audit-only.\n- test-writer — Playwright E2E + Vitest unit tests.\nProject-specific (~/.claude/agents/ overlay):\n- domain-builder — donation/menu/booking/medical/child-safety/local-business sections, NEW files only in src/components/sections/.\n- validator-fixer — runs scripts/run-validators.mjs, fixes the 13 build_validators violation codes.\n\n## Orchestration Loop\n1. Read every _ context file. Build a one-paragraph site brief in your head.\n2. Customize template with brand colors, logo, content, images. This is the only work you do directly.\n3. `npm run build`. If build fails, fix and rebuild.\n4. PARALLEL FAN-OUT (single message, multiple Task tool calls):\n   - domain-builder (creates section components from _domain_features.json)\n   - visual-qa (screenshots + GPT-4o critique)\n   - seo-auditor (title/meta/JSON-LD/OG)\n   - accessibility-auditor (axe-core 6 breakpoints)\n   - performance-profiler (Lighthouse + bundle budgets)\n5. Collect reports. Route findings:\n   - Visual/copy/SEO issues -> content-writer for copy, validator-fixer for HTML/asset/meta/JSON-LD/sitemap/lightbox/js-chunk fixes.\n   - Accessibility/perf issues -> validator-fixer (it has Edit) using audit reports as input.\n6. Rebuild. Re-run validator-fixer until `blockers === 0`.\n7. completeness-checker as final gate. If it returns NOT_DONE, loop back to step 4.\n8. `node /home/cuser/upload-to-r2.mjs` to publish.\n\n## Hard Rules\n- Spawn parallel subagents in a SINGLE message with multiple Task calls.\n- File partition: domain-builder owns src/components/sections/, validator-fixer owns public/ + index.html shell + vite.config.ts + package.json + sitemap.xml.\n- Audit-only agents MUST NOT edit. Forward their reports to validator-fixer.\n- Stripe/Linear/Vercel-level polish. 10+ animations, 15+ images, dark theme by default, WCAG 2.2 AA, 6 breakpoints (375/390/768/1024/1280/1920), zero console errors.\n- Validator outputs from scripts/run-validators.mjs are the source of truth. Do not declare DONE until blockers === 0 AND completeness-checker returns DONE.\n' > /home/cuser/.claude/CLAUDE.md && \
    chown -R cuser:cuser /home/cuser

# Surface upstream meta files at standard locations so other tools (Codex,
# Cursor, etc.) running inside the container also pick up the inherited
# instructions. These are symlinks — when container-server.mjs git-pulls
# ~/.agentskills every 10 min the symlink targets update automatically.
RUN ln -sf /home/cuser/.agentskills/AGENTS.md /home/cuser/AGENTS.md && \
    ln -sf /home/cuser/.agentskills/_router.md /home/cuser/_router.md && \
    ln -sf /home/cuser/.agentskills/CONVENTIONS.md /home/cuser/CONVENTIONS.md 2>/dev/null || true && \
    ln -sf /home/cuser/.agentskills/.editorconfig /home/cuser/.editorconfig 2>/dev/null || true

EXPOSE 8080
