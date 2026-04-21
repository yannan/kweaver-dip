########################### Stage 0: Maven build ########################
ARG BUILD_IMAGE=maven:3.9-eclipse-temurin-8
ARG BASE_IMAGE=openjdk:8u342-jdk

FROM ${BUILD_IMAGE} AS builder

WORKDIR /build

# Cache Maven dependencies first
COPY pom.xml ./
RUN --mount=type=cache,target=/root/.m2 \
    mvn -B -q -DskipTests dependency:go-offline || true

COPY src ./src
RUN --mount=type=cache,target=/root/.m2 \
    mvn -B -q -DskipTests package && \
    cp target/standardization-web-*.jar /standardization-web.jar && \
    cp -r src/main/resources /config

########################### Stage 1: Runtime ########################
FROM ${BASE_IMAGE} AS prod

ENV TZ=Asia/Shanghai
ENV JAVA_OPTS="-Xms512m -Xmx1024m"

WORKDIR /standardization

RUN ln -sf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone && \
    sed -i 's|http://deb.debian.org/debian|http://mirrors.aliyun.com/debian|g' /etc/apt/sources.list && \
    sed -i 's|http://security.debian.org/debian-security|http://mirrors.aliyun.com/debian-security|g' /etc/apt/sources.list && \
    apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    chmod -R 775 /standardization

COPY --from=builder /standardization-web.jar ./standardization-web.jar
COPY --from=builder /config ./config

CMD ["sh", "-c", "java -Dfile.encoding=UTF-8 $JAVA_OPTS -jar standardization-web.jar --spring.config.location=./config/"]
