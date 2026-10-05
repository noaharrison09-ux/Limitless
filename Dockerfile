# Limitless: one container serves the app, the API, and runs the background jobs.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.ts"]
