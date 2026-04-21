########################### Stage 0: Build ########################
ARG BUILD_IMAGE=node:22.18.0
ARG BASE_IMAGE=nginx:1.28.1-alpine

FROM ${BUILD_IMAGE} AS builder

WORKDIR /app

# Install dependencies first for better caching
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000

# Copy sources and build
COPY . .
RUN yarn build

########################### Stage 1: Runtime ########################
FROM ${BASE_IMAGE} AS prod

COPY --from=builder /app/build/ /app/dist/
COPY ci/web.nginx /etc/nginx/conf.d/default.conf

EXPOSE 8686
ENTRYPOINT ["nginx", "-g", "daemon off;"]
