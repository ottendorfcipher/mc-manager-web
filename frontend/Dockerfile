# syntax=docker/dockerfile:1

# ── Build the frontend ────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
# --ignore-scripts is a supply-chain guard (see .npmrc).
RUN npm ci --ignore-scripts
COPY frontend/ ./
RUN npx vite build

# ── Serve with nginx ──────────────────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
