# The definitions service (`engine/definitions`): one bare git repository per
# organisation under DEFINITIONS_ROOT (a mounted volume), smart HTTP for the
# CLI, pre-/post-receive hooks over a unix socket on the same host.
# Built from the repository root: `docker build -f deploy/definitions.Dockerfile .`
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# The workspaces the service is built from: compose (its dependency) and itself.
COPY package.json package-lock.json ./
COPY engine/tsconfig.base.json ./engine/tsconfig.base.json
COPY engine/compose ./engine/compose
COPY engine/definitions ./engine/definitions
COPY engine/cli/package.json ./engine/cli/package.json
RUN npm ci --workspaces --include-workspace-root --ignore-scripts \
 && npm run build -w engine/compose -w engine/definitions \
 && npm prune --omit=dev
COPY scripts/dev-definitions.mjs ./scripts/dev-definitions.mjs
ENV DEFINITIONS_ROOT=/data/definitions \
    DEFINITIONS_SOCK=/data/definitions.sock \
    DEFINITIONS_HOOKS=/app/engine/definitions/dist/hooks \
    DEFINITIONS_LISTEN=0.0.0.0:8402
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8402
# The same three-line entry development uses (`start(configFromEnv())`); no watch here.
CMD ["node", "scripts/dev-definitions.mjs"]
