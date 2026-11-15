# syntax=docker/dockerfile:1
#
# Switchboard, hosted. Build:  docker build -t switchboard .
# Run:    docker run -p 7690:7690 -v switchboard:/data \
#           -e SWITCHBOARD_ADMIN_PASSWORD=... -e SWITCHBOARD_PUBLIC_URL=https://sb.example.com switchboard
#
# The image installs the same npm package that is published, built from
# this checkout, plus Node, Python and uv so stdio MCP servers started with
# npx or uvx work. State lives in /data.

FROM node:24-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.base.json ./
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
ARG VERSION=0.0.0-docker
ENV SWITCHBOARD_VERSION=${VERSION}
RUN pnpm build \
 && cd apps/cli \
 && cp ../../LICENSE ../../NOTICE ../../README.md . \
 && npm pkg set version="${VERSION}" \
 && mkdir /out && npm pack --pack-destination /out

FROM node:24-slim
# uv/uvx for Python MCP servers; tini forwards signals so shutdown is clean.
COPY --from=ghcr.io/astral-sh/uv:0.13.8 /uv /uvx /usr/local/bin/
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 ca-certificates git tini \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/ /tmp/pkg/
RUN npm install -g /tmp/pkg/mcp-switchboard-*.tgz && rm -rf /tmp/pkg /root/.npm \
 && mkdir -p /data && chown node:node /data

ENV SWITCHBOARD_HOME=/data \
    SWITCHBOARD_HOST=0.0.0.0 \
    SWITCHBOARD_PORT=7690 \
    NODE_ENV=production
USER node
WORKDIR /home/node
VOLUME ["/data"]
EXPOSE 7690
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:7690/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--", "switchboard"]
CMD ["up", "--no-open"]
