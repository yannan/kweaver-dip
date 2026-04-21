########################### Stage 0 ########################
ARG BUILD_IMAGE=golang:1.24.11
ARG BASE_IMAGE=golang:1.24.11

FROM ${BUILD_IMAGE} AS builder

WORKDIR /build

# 复制 go mod 文件
COPY chat-data/sailor-service/go.mod chat-data/sailor-service/go.sum ./

# 下载依赖
ARG GOPROXY_URL="http://goproxy.cn,direct"
ARG GOPRIVATE="github.com/kweaver-ai/*"
ARG GIT_AUTH_TOKEN

ENV GOPROXY=${GOPROXY_URL} \
    GOPRIVATE=${GOPRIVATE}

# Configure git credentials for private Go modules
RUN if [ -n "${GIT_AUTH_TOKEN}" ]; then \
      git config --global url."https://x-access-token:${GIT_AUTH_TOKEN}@github.com/".insteadOf "https://github.com/"; \
    fi

RUN go mod download

# 复制源代码
COPY chat-data/sailor-service/ ./

# 构建应用
ARG SERVER_VERSION=0.1.0
RUN CGO_ENABLED=0 go build -ldflags "-s -w -X main.Version=${SERVER_VERSION}" -o ./app ./cmd

########################### Stage 1 ########################
FROM ${BASE_IMAGE} AS prod

COPY --from=builder /build/app /opt/af/app
COPY --from=builder /build/cmd/server/config/static /opt/af/static

WORKDIR /opt/af/

RUN chmod 757 -R /opt/af/  \
   && mkdir -p /opt/log/af  \
   && chmod 757 -R /opt/log/af

ENTRYPOINT ["/opt/af/app"]
