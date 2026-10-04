FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
ENV PORT=8090
EXPOSE 8090
CMD ["npm", "start"]
