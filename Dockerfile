FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/app/data HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir data && chown node:node data
COPY src ./src
COPY public ./public
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
