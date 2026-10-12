# syntax=docker/dockerfile:1.7
FROM node:20.18.3-alpine3.21 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/web apps/web
RUN npm run build -w apps/web

FROM nginxinc/nginx-unprivileged:1.27.5-alpine3.21 AS runtime
USER root
RUN apk update && apk upgrade --no-cache
USER 101
COPY infra/deployment/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
