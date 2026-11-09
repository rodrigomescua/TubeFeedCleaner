FROM mcr.microsoft.com/playwright:v1.65.0-noble
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY app ./app
RUN mkdir -p /app/data /data/chrome
ENV NODE_ENV=production PORT=8080 INTERVAL_MINUTES=30 DATA_FILE=/app/data/state.json CHROME_PROFILE=/data/chrome
EXPOSE 8080
ENV DISPLAY=:99
CMD ["sh", "/app/app/start.sh"]
