FROM node:20-alpine AS build
WORKDIR /usr/src/app
RUN apk add --no-cache python3 g++ make git
COPY package*.json ./
RUN npm install --production
COPY . .
RUN mkdir -p /usr/src/app/data

FROM node:20-alpine
WORKDIR /usr/src/app
RUN apk add --no-cache ca-certificates
COPY --from=build /usr/src/app ./
ENV NODE_ENV=production
ENV PORT=${PORT:-3000}
EXPOSE ${PORT:-3000}
CMD ["node","index.js"]
