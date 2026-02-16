FROM node:20-bookworm-slim AS builder

WORKDIR /app

ARG VITE_ALLOW_SELF_REGISTRATION=false
ENV VITE_ALLOW_SELF_REGISTRATION=${VITE_ALLOW_SELF_REGISTRATION}

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:4173/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
