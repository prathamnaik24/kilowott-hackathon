# Single-service image: Express API + built React UI + (optional) mock WooCommerce store.
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=4000 DATABASE_URL=file:./prod.db
COPY --from=build /app /app
EXPOSE 4000
CMD ["npm", "run", "start", "-w", "server"]
