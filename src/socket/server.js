'use strict';

import logger from 'capn-log';
import cryptoRandomString from 'crypto-random-string';
import e from 'express';
import { WebSocketServer } from 'ws';

const MODULE = 'proxy/server';

function heartbeat() {
  this.isAlive = true;
}

let wss = null;

// once a new clientId appears, the existing clientId will always be ignored
const deadClientIds = new Set();

const requestsOutstanding = {};

// this proxy will only send requests to one active client
let activeClient = null;
let activeClientId = null;

function setup(server) {
  const log = logger.getLogger(MODULE, 'setup');
  log.debug('setup called');
  wss = new WebSocketServer({server});
  log.debug('create socket server');
  wss.on('connection', function connection(ws) {
    const log = logger.getLogger(MODULE, 'onConnection');
    log.debug('connected');
    ws.isAlive = true;
    ws.on('pong', heartbeat);
    ws.on('message', function message(data, isBinary) {
      log.debug('got message');
      
      if (!isBinary) {

        // ascii messages are always assumed JSON
        let message = JSON.parse(data);
        switch(message.type) {
        case 'clientId':
          if (deadClientIds.has(message.clientId)) {
            // reject
            this.close(409, 'Dead ClientId');

          } else {
            if (activeClientId !== message.clientId) {
              deadClientIds.add(activeClientId);
              activeClientId = message.clientId;
            }
            activeClient = this;
          }
        }
      }
    });
  });
}

const interval = setInterval(function ping() {
  if (wss) {
    wss.clients.forEach(function each(ws) {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }
}, global.config('socket.ping.interval'));

function requestDocument(path) {
  return new Promise((resolve, reject) => {
    if (activeClient) {
      let requestId = cryptoRandomString({length: 32, type: 'alphanumeric'});
      activeClient.message(JSON.stringify({path, requestId}), false);

      let timeout = setTimeout(() => {
        rejected = true;
        reject('timeout');
      }, 1000);
      let rejected = false;
      requestsOutstanding[requestId] = function(headers, doc) {
        if (!rejected) {
          cancelTimout(timeout);
          resolve({headers, doc});
        }
      }
    } else {
      // no activeClient
      reject('no_client');
    }
  });
}

export { requestDocument, requestsOutstanding, setup };
