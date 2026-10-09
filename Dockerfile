FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY mcp ./mcp
COPY shared ./shared
COPY web ./web
COPY ocr ./ocr
COPY LICENSE ./LICENSE
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production KOOKS_HOST=0.0.0.0 PORT=4317 KOOKS_DB_PATH=/data/kooks.sqlite
USER node
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:4317/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "web/server.js"]
