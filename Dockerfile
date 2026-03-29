FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build
EXPOSE 7702
ENV PORT=7702
CMD ["node", "server.js"]
