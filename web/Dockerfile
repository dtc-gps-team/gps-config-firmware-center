# web (Next.js) image สำหรับ docker compose profile `app`
# (docs/deploy/docker-compose.md)
#
# เบราว์เซอร์เรียก API ผ่าน origin เดียวกับหน้าเว็บ (`/api/v1`, ค่าเริ่มต้นใน
# src/lib/api.ts) แล้ว reverse proxy (Caddy) ส่งต่อไป backend จึงไม่ต้องฝัง
# NEXT_PUBLIC_API_BASE_URL ตอน build image เดียวใช้ได้ทุกที่ที่ deploy
#
# ใช้ Node 20 ให้ตรงกับ CI และ Debian ให้ตรงกับ backend

FROM node:20.20.2-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

FROM node:20.20.2-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  PORT=3000 \
  HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
