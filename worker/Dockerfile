# Worker do WhatsApp (processo de longa duração, 1 réplica).
# Build a partir da raiz do repositório:  docker build -f worker/Dockerfile .
FROM node:22-slim
# ffmpeg converte áudios gravados no navegador para OGG/Opus (áudio de voz do WhatsApp)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
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
