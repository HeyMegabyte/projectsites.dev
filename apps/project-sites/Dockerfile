FROM node:22-slim

# System deps (curl for GPT-4o fallback, git for repos)
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

# GPT-4o inspection script (called between prompts for design critique)
COPY scripts/inspect.js /home/cuser/inspect.js

# Set up CLAUDE.md for cuser
RUN mkdir -p /home/cuser/.claude && \
    printf '# ProjectSites Build Agent\n\n## Skills\nLoad skills from ~/.agentskills/_router.md for build guidance.\n\n## Template\nProject template at ~/template/ — use as starting point for Vite+React+Tailwind projects.\nCopy template files first, then customize with business-specific content.\n\n## Stack\nVite + React 18 + Tailwind CSS 3 + react-router-dom. TypeScript. No CDN scripts.\npackage.json must have: dev (vite), build (vite build), preview (vite preview).\n\n## Web Research\nYou have internet access. Use curl to verify facts from _research.json.\nCross-check business hours, addresses, phone numbers against the original website.\nIf research data conflicts with scraped content, prefer scraped content.\n' > /home/cuser/.claude/CLAUDE.md && \
    chown -R cuser:cuser /home/cuser

EXPOSE 8080
