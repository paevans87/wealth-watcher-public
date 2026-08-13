FROM node:26-alpine AS builder
WORKDIR /app
COPY WealthWatcher.UI/package*.json ./WealthWatcher.UI/
RUN npm ci --prefix WealthWatcher.UI
COPY WealthWatcher.UI/ ./WealthWatcher.UI/
COPY docs/release-notes/ ./docs/release-notes/
COPY scripts/ ./scripts/
RUN npm run build --prefix WealthWatcher.UI

FROM nginx:alpine
COPY --from=builder /app/WealthWatcher.UI/dist /usr/share/nginx/html
COPY WealthWatcher.UI/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
