# ---- 阶段 1：依赖解析（npm ci 需要与 package.json 配套的 lockfile）----
FROM node:20-alpine AS deps
WORKDIR /app
COPY server/package.json server/package-lock.json server/
COPY web/package.json web/package-lock.json web/
# 校验 lockfile 与 package.json 一致（Docker 构建缓存友好）
RUN cd server && npm ci --omit=dev --no-audit --no-fund
RUN cd web && npm ci --no-audit --no-fund

# ---- 阶段 2：构建前端 ----
FROM node:20-alpine AS web-build
WORKDIR /app/web
COPY --from=deps /app/web/node_modules ./node_modules
COPY web/package.json web/package-lock.json ./
COPY web/ ./
RUN npm run build

# ---- 阶段 3：运行镜像 ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps --chown=app:app /app/server/node_modules ./server/node_modules
COPY --chown=app:app server ./server
COPY --from=web-build --chown=app:app /app/web/dist ./web/dist
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/server.js"]
