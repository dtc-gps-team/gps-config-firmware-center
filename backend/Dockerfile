# backend (NestJS + Prisma) image สำหรับ docker compose profile `app`
# (docs/deploy/docker-compose.md)
#
# มี 2 target ที่ใช้จริง:
#   runtime   รัน backend อย่างเดียว ติดตั้งเฉพาะ dependencies (ไม่มีเครื่องมือพัฒนา)
#   migrator  รัน `prisma migrate deploy` + seed แล้วจบ ต้องมี prisma CLI ซึ่งอยู่ใน
#             devDependencies จึงใช้ node_modules ครบชุด
#
# ใช้ Debian (bookworm-slim) ไม่ใช้ alpine เพราะ query engine ของ Prisma บน musl
# มีปัญหาเรื่อง openssl บ่อย และใช้ Node 20 ให้ตรงกับ CI

FROM node:20.20.2-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- ติดตั้ง dependencies ครบชุด (postinstall รัน prisma generate) ----
FROM base AS deps
# prisma.config.ts อ่าน DATABASE_URL ตอน generate แต่ไม่ได้ต่อฐานข้อมูลจริง
# ค่านี้ใช้แค่ตอน build ไม่ติดไปกับ image ที่รันจริง (runtime ตั้งค่าใหม่จาก compose)
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# ---- build ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- migrator: migrate deploy + seed (seed ถูก compile เป็น dist/prisma/seed.js แล้ว) ----
FROM build AS migrator
ENV NODE_ENV=production
USER node
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/prisma/seed.js"]

# ---- ตัด devDependencies ออก (เก็บ Prisma client ที่ generate แล้วไว้) ----
FROM build AS prod-deps
RUN npm prune --omit=dev

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3001
CMD ["node", "dist/src/main.js"]
