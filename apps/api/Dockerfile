# syntax=docker/dockerfile:1.7
FROM node:20.18.3-alpine3.21 AS build
RUN apk update && apk upgrade --no-cache
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/api apps/api
RUN npm run build -w apps/api

FROM node:20.18.3-alpine3.21 AS operations
RUN apk update && apk upgrade --no-cache \
    && apk add --no-cache postgresql16-client tar && npm install -g npm@^11
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY scripts scripts
COPY apps/api/migrations apps/api/migrations
COPY apps/api/scripts apps/api/scripts
ENTRYPOINT ["npm"]

FROM node:20.18.3-alpine3.21 AS runtime
RUN apk update && apk upgrade --no-cache
ENV NODE_ENV=production \
    PORT=4000 \
    FILE_STORAGE_ROOT=/data/documents
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app/apps/api/dist apps/api/dist
RUN mkdir -p /data/documents && chown -R node:node /app /data
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
