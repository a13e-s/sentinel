#
# Dockerfile for Sentinel — Provider-agnostic AI pentest agent
# Uses node:20-slim with native module support for @temporalio
#

FROM node:20-slim AS builder

# Install build dependencies for native modules (@temporalio uses native extensions)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
COPY mcp-server/package*.json ./mcp-server/

# Install all dependencies (including devDependencies for TypeScript build)
RUN npm ci && \
    cd mcp-server && npm ci && cd .. && \
    npm cache clean --force

# Copy application source code
COPY . .

# Build TypeScript (mcp-server first, then main project)
RUN cd mcp-server && npm run build && cd .. && npm run build

# Remove devDependencies after build to reduce image size
RUN npm prune --production && \
    cd mcp-server && npm prune --production

# === Runtime stage ===
FROM node:20-slim

# Install recon tools, browser dependencies, and utilities for security analysis
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Core utilities
    git \
    bash \
    ca-certificates \
    curl \
    wget \
    unzip \
    jq \
    # Network recon tools
    nmap \
    dnsutils \
    whois \
    netcat-openbsd \
    # Language runtimes for security tools
    python3 \
    python3-pip \
    ruby \
    # Chromium for Playwright browser automation
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# Install Go-based recon tools from ProjectDiscovery
RUN ARCH=$(dpkg --print-architecture) && \
    for TOOL in subfinder httpx; do \
      curl -sL "https://github.com/projectdiscovery/${TOOL}/releases/latest/download/${TOOL}_linux_${ARCH}.zip" \
        -o /tmp/${TOOL}.zip && \
      unzip -qo /tmp/${TOOL}.zip -d /tmp/${TOOL} && \
      mv /tmp/${TOOL}/${TOOL} /usr/local/bin/ && \
      chmod +x /usr/local/bin/${TOOL} && \
      rm -rf /tmp/${TOOL}* ; \
    done || true

# Install WhatWeb (Ruby-based web fingerprinter)
RUN git clone --depth 1 https://github.com/urbanadventurer/WhatWeb.git /opt/whatweb && \
    chmod +x /opt/whatweb/whatweb && \
    gem install addressable 2>/dev/null && \
    echo '#!/bin/bash' > /usr/local/bin/whatweb && \
    echo 'cd /opt/whatweb && exec ./whatweb "$@"' >> /usr/local/bin/whatweb && \
    chmod +x /usr/local/bin/whatweb || true

# Create non-root user
RUN groupadd -g 1001 sentinel && \
    useradd -u 1001 -g sentinel -m -s /bin/bash sentinel

WORKDIR /app

# Copy built application from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/mcp-server/node_modules ./mcp-server/node_modules
COPY --from=builder /app/mcp-server/dist ./mcp-server/dist
COPY --from=builder /app/mcp-server/package.json ./mcp-server/package.json

# Create directories for runtime data
RUN mkdir -p /app/configs /app/prompts /app/audit-logs /repos && \
    chown -R sentinel:sentinel /app /repos

# Switch to non-root user
USER sentinel

# Environment
ENV NODE_ENV=production
ENV SENTINEL_DOCKER=true
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Configure Git identity and trust all directories
RUN git config --global user.email "agent@localhost" && \
    git config --global user.name "Sentinel Agent" && \
    git config --global --add safe.directory '*'

ENTRYPOINT ["node", "dist/temporal/worker.js"]
