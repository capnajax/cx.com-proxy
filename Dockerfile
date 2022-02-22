FROM node:lts

COPY package.json /tmp/package.json
COPY package-lock.json /tmp/package-lock.json
RUN npm install -g npm
RUN cd /tmp && npm install --production
RUN mkdir -p /app && cp -a /tmp/node_modules /tmp/package*.json /app
WORKDIR /app

COPY config.yaml /app
COPY index.js /app

COPY src /app/src
CMD npm start
