# Worker do WhatsApp (processo de longa duração, 1 réplica).
# Build a partir da raiz do repositório:  docker build -f worker/Dockerfile .
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm i --no-save tsx@4
COPY tsconfig.json ./
COPY worker ./worker
COPY src/shared ./src/shared
# scripts/ permite cadastrar clientes de dentro do container (create-tenant.ts)
COPY scripts ./scripts
USER node
CMD ["npx", "tsx", "worker/index.ts"]
