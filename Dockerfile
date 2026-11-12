# The game server's image, which Railway builds from this file: Node, the server workspace's production dependencies,
# server/ and the rules it shares with the browser (src/core/). Locally: docker build -t birdie-server . and
# docker run -p 2567:2567 birdie-server (the server listens on PORT, 2567 unless set).
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# Railway's edge sets X-Real-IP to the address the request came from and replaces any copy a client sends. Behind
# another proxy, set CLIENT_IP_HEADER to its header (or to nothing) when running the image.
ENV CLIENT_IP_HEADER=X-Real-IP
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --omit=dev --workspace=server --no-audit --no-fund && npm cache clean --force
COPY src/core src/core
COPY server/src server/src
USER node
# node itself, not npm, so the server gets the stop signal and closes its rooms
CMD ["node", "server/src/index.js"]
