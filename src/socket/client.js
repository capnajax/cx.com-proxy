'use strict';

import argv from '../args.js';
import axios from 'axios';
import cryptoRandomString from 'crypto-random-string';
import { promises as fs, readFileSync } from 'fs';
import logger from 'capn-log';
import { WebSocket } from 'ws';
import _ from 'lodash';

const MODULE = 'proxy/ws-client';
const PROTOCOL = 'cxproxy';
const c = global.config;

const clientId = cryptoRandomString({length: 32, type: 'alphanumeric'})
let socket;

let caCert = _.has(global.argv, 'caCertFile')
  ? readFileSync(global.argv.caCertFile).toString()
  : undefined;
let sslCert = _.has(global.argv, 'sslCertFile')
  ? readFileSync(global.argv.sslCertFile).toString()
  : undefined;
let sslKey = _.has(global.argv, 'sslKeyFile')
  ? readFileSync(global.argv.sslKeyFile).toString()
  : undefined;

/**
 * @function proxyClientOpts
 * Create options to use for connecting to the proxy server
 */
function proxyClientOpts(opts) {
  const log = logger.getLogger(MODULE, 'proxyClientOpts');

  const insecure = !!c('security.insecure');
  insecure && log.warn('insecure certificates enabled');
  log.trace('insecure: "%s"', insecure);

  let result = _.extend({
    ca: caCert,
    cert: sslCert,
    key: sslKey,
    rejectUnauthorized: !insecure
  }, opts);

  return result;
}

function httpGet(dataObj) {
  const log = logger.getLogger(MODULE, httpGet);

  for (let i of ['path', 'requestId']) {
    if (!_.has(dataObj, i)) {
      throw `\`get\` dataObj missing required value for "${i}"`;
    }
  }

  // make HTTP client request
  axios.get(global.config('backend.baseUrl') + '/' + dataObj.path)
    .then(response => {

      // post result to server
      let forwardHeaders = {
        'x-capnajax-status': response.status,
        'x-capnajax-statusText': response.statusText,
        'content-type': response.headers['content-type'],
        'content-length': response.headers['content-length'],
        'x-capnajax-request-id': dataObj.requestId,
        'x-capnajax-path': dataObj.path
      };

      let postOptions = {
        method: 'PUT',
        headers: forwardHeaders,
        data: response.data,
        url: `https://${argv.frontSide}/_content`
      };
      axios(postOptions)
        .then(response => {
          if (response.status >= 400) {
            console.error('Got error %s responding to GET (%s) %s',
              response.status, dataObj.requestId, dataObj.path);
          }
        });
    });
}

function heartbeat() {
  const log = logger.getLogger(MODULE, heartbeat);
  const self = this;
  log.trace('heartbeat');

  clearTimeout(self.pingTimeout);

  // Use `WebSocket#terminate()`, which immediately destroys the connection,
  // instead of `WebSocket#close()`, which waits for the close timer.
  // Delay should be equal to the interval at which your server
  // sends out pings plus a conservative assumption of the latency.
  self.pingTimeout = setTimeout(() => {
    // start a new socket    
    log.error('Ping timeout. Recreating socket');
    openWs()
    .then(s => {
      socket = s;
      // end the existing socket
      self.terminate();
    })
  }, c('socket.ping.interval') + c('socket.ping.timeout'));
}

async function openWs() {
  const log = logger.getLogger(MODULE, openWs);
  log.debug('openWs called');

  const proxyOpts = proxyClientOpts({});

  log.debug('creating WebSocket');

  const ws = new WebSocket(
    `wss://${argv.frontSide}`, 
    proxyOpts
    );

  log.debug('created WebSocket');


  ws.on('message', function message(data, isBinary) {
    log.debug('message received');

    if (!isBinary) {
      try {
        let dataObj = JSON.parse(data);
        switch(dataObj.command) {
        case 'get':

          httpGet(dataObj);





        }



      } catch(reason) {
        log.error('Invalid message: %s', data)
        log.error(' --> reason: %s', reason)
      }

    } else {
      log.error('Received unexpected binary message');
    }




  });

  ws.on('open', heartbeat);
  ws.on('ping', heartbeat);
  ws.on('close', function clear() {
    clearTimeout(this.pingTimeout);
  });

  log.debug('openWs complete');

  return ws;
}

socket = openWs();
