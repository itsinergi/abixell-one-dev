# syntax=docker/dockerfile:1.7
FROM node:20.18.3-alpine3.21 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/api apps/api
RUN npm run build -w apps/api

FROM build AS operations
ENV NODE_ENV=production
RUN apk add --no-cache postgresql16-client tar
COPY scripts scripts
ENTRYPOINT ["npm"]

FROM node:20.18.3-alpine3.21 AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    FILE_STORAGE_ROOT=/data/documents
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
RUN mkdir -p /data/documents && chown -R node:node /app /data
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
