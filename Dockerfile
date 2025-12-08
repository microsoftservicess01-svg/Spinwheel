FROM node:20-alpine
WORKDIR /usr/src/app

# install build deps for sqlite binaries if needed
RUN apk add --no-cache python3 g++ make cairo-dev jpeg-dev zlib-dev

# copy package manifests first for better caching
COPY package*.json ./
RUN npm ci --production

# copy app
COPY . .

# create data directory (used by sqlite)
RUN mkdir -p /usr/src/app/data

# Render sets PORT env var automatically. Default to 3000.
ENV PORT=${PORT:-3000}
EXPOSE ${PORT:-3000}

# Start server
CMD ["node", "index.js"]
