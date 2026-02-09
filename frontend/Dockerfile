FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install
RUN npx playwright install --with-deps chromium

COPY . .
RUN npm run build

EXPOSE 4173
CMD ["npm", "run", "preview"]
