FROM node:22-bookworm-slim AS deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.json prisma.config.ts ./
COPY prisma prisma
COPY app/package.json app/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/mosaic/package.json packages/mosaic/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/worker/package.json packages/worker/package.json

RUN npm ci

FROM deps AS build
COPY . .
RUN DIRECT_URL=postgresql://build:build@localhost:5432/build DATABASE_URL=postgresql://build:build@localhost:5432/build npm run prisma:generate
RUN DIRECT_URL=postgresql://build:build@localhost:5432/build DATABASE_URL=postgresql://build:build@localhost:5432/build npm run typecheck

FROM node:22-bookworm-slim AS worker

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg openssl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system instamosaic \
  && useradd --system --gid instamosaic --create-home instamosaic

COPY --from=build /app/package.json /app/package-lock.json /app/tsconfig.json /app/prisma.config.ts ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/prisma prisma
COPY --from=build /app/packages packages
COPY --from=build /app/app/src/lib app/src/lib

USER instamosaic
EXPOSE 8080

CMD ["npm", "run", "worker:http"]
