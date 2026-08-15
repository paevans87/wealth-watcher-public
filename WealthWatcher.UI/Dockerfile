FROM node:26-alpine@sha256:aadf416b2cdce311a8811ba3f0608a61b77dbf997500e2eafe781b51f6a0b019 AS builder
WORKDIR /app
COPY WealthWatcher.UI/package*.json ./WealthWatcher.UI/
RUN npm ci --prefix WealthWatcher.UI
COPY WealthWatcher.UI/ ./WealthWatcher.UI/
COPY docs/release-notes/ ./docs/release-notes/
COPY scripts/ ./scripts/
RUN npm run build --prefix WealthWatcher.UI

FROM nginx:alpine@sha256:4a73073bd557c65b759505da037898b61f1be6cbcc3c2c3aeac22d2a470c1752
COPY --from=builder /app/WealthWatcher.UI/dist /usr/share/nginx/html
COPY WealthWatcher.UI/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
