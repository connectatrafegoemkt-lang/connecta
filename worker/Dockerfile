# Worker do WhatsApp (processo de longa duração, 1 réplica).
# Build a partir da raiz do repositório:  docker build -f worker/Dockerfile .
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm i --no-save tsx
COPY worker ./worker
COPY tsconfig.json ./
USER node
CMD ["npx", "tsx", "worker/index.ts"]
