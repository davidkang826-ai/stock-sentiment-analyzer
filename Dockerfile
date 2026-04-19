FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg curl unzip && rm -rf /var/lib/apt/lists/*
RUN pip3 install yt-dlp faster-whisper youtube-transcript-api pytubefix --break-system-packages
# Install deno — yt-dlp auto-detects it for YouTube JS challenge solving
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh

RUN corepack enable

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000
ENV NODE_ENV=production

CMD ["npm", "run", "start"]
