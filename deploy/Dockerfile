FROM platformatic/node-caged:25-slim AS builder

RUN npm install -g pnpm

WORKDIR /app

# Copy everything first (fumadocs-mdx postinstall needs source.config.ts)
COPY . .

RUN pnpm install --no-frozen-lockfile

# Build katman (skip dashboard — pre-built in lib/dashboard/index.html)
RUN pnpm tsdown

# Build docs with node-server preset
ENV NITRO_PRESET=node-server
RUN cd docs && pnpm build

FROM platformatic/node-caged:25-slim

WORKDIR /app

COPY --from=builder /app/docs/.output .output

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
