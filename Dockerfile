FROM node:20-alpine
WORKDIR /usr/src/app

RUN apk add --no-cache python3 g++ make

COPY package*.json ./
RUN npm install --production

COPY . .

RUN mkdir -p /usr/src/app/data

ENV PORT=${PORT:-3000}
EXPOSE ${PORT:-3000}

CMD ["node","index.js"]
