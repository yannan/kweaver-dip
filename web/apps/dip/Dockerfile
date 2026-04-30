FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY tooling ./tooling
COPY packages ./packages
COPY apps/dip ./apps/dip

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @kweaver-web/dip build

FROM nginx:1.28.1-alpine

EXPOSE 80

COPY ci/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/dip/dist /app/dist
