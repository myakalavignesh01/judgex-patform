FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server ./server
ENV NODE_ENV=production
ENV PORT=8787
USER node
EXPOSE 8787
CMD ["node", "--experimental-strip-types", "server/service.ts"]
