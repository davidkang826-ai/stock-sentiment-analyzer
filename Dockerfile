FROM node:20-bookworm-slim

RUN corepack enable

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000
ENV NODE_ENV=production

CMD ["npm", "run", "start"]
