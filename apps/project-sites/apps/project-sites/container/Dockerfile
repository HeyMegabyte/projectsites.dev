FROM ubuntu:24.04

# Pin all versions for reproducibility
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_VERSION=22.15.0
ENV NPM_VERSION=11.3.0

# System deps — top 30 tools a web builder needs
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl=8.5.0-2ubuntu10.6 \
    wget=1.21.4-1ubuntu4.1 \
    git=1:2.43.0-1ubuntu7.2 \
    ca-certificates=20240203 \
    gnupg=2.4.4-2ubuntu17 \
    imagemagick=8:6.9.12.98+dfsg1-0ubuntu0.24.04.2 \
    ffmpeg=7:6.1.1-3ubuntu5 \
    jq=1.7.1-3build1 \
    unzip=6.0-28ubuntu4.1 \
    zip=3.0-13build1 \
    python3=3.12.3-0ubuntu2 \
    python3-pip=24.0+dfsg-1ubuntu1.1 \
    build-essential=12.10ubuntu1 \
    libvips-dev=8.15.1-1.1build4 \
    libcairo2-dev=1.18.0-3build1 \
    libpango1.0-dev=1.52.1-1build1 \
    librsvg2-bin=2.58.0+dfsg-1build1 \
    fonts-inter=4.0-1 \
    fontconfig=2.15.0-1.1ubuntu2 \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs=22.15.0-1nodesource1 \
    && npm install -g npm@${NPM_VERSION} \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user (Claude Code blocks --dangerously-skip-permissions as root)
RUN useradd -m -s /bin/bash cuser \
    && mkdir -p /app /tmp/builds \
    && chown -R cuser:cuser /app /tmp/builds /home/cuser

# Copy the build server
COPY build-server.js /app/server.js
RUN chown cuser:cuser /app/server.js

EXPOSE 8080

# Run as the server directly — no shell script shenanigans
CMD ["node", "/app/server.js"]
