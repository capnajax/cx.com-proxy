'use strict';

import argv from '../args.js';
import axios from 'axios';
import cryptoRandomString from 'crypto-random-string';
import https from 'https';
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

let axiosUplinkInst = undefined;
/**
 * @function axiosUplink 
 * Return an instance of axios to use to upload data
 * @return {axios.AxiosInstance}
 */
function axiosUplink() {
  if (!axiosUplinkInst) {
    axiosUplinkInst = axios.create({
      httpsAgent: new https.Agent(proxyClientOpts({}))
    });
  }
  return axiosUplinkInst;
}
  
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
    rejectUnauthorized: !insecure,
    timeout: 1000
  }, opts);

  return result;
}

function httpGet(dataObj) {
  const log = logger.getLogger(MODULE, httpGet);
  log.trace('%s', dataObj);

  const url = global.config('backend.baseUrl') + dataObj.path;
  log.info('GET %s', url);

  for (let i of ['path', 'requestId']) {
    if (!_.has(dataObj, i)) {
      throw `\`get\` dataObj missing required value for "${i}"`;
    }
  }

  // make HTTP client request
  axios.get(url)
    .then(response => {

      log.trace('response: %s', response);
      log.trace('response.headers: %s', response.headers);

      let dataBuffer = Buffer.from(response.data);
      // post result to server
      let forwardHeaders = {
        'x-capnajax-status': response.status,
        'x-capnajax-statusText': response.statusText,
        'x-capnajax-content-type': response.headers['content-type'],
        'content-type': 'application/octet-stream',
        'content-length': dataBuffer.length,
        'x-capnajax-request-id': dataObj.requestId,
        'x-capnajax-path': dataObj.path
      };

      log.trace('forwardHeaders: %s', forwardHeaders);

      let putOptions = proxyClientOpts({
        method: 'PUT',
        headers: forwardHeaders,
        url: `https://${argv.frontSide}/_content`
      });

      let uplink = axiosUplink();

      log.trace('Got response, POSTing %s', putOptions);
      log.trace(' --> headers %s', putOptions.headers);
      log.trace(' --> data %s', dataBuffer.toString());
      putOptions.data = dataBuffer;

      uplink(putOptions)
        .then(response => {
          log.trace('POSTed.');
          log.trace('Status %s', response.status);
          if (response.status >= 400) {
            console.error('Got error %s responding to GET (%s) %s',
              response.status, dataObj.requestId, dataObj.path);
          }
        })
        .catch(e => {
          log.error('failed upload response: %s', e);
        });
    });
}

let pingTimeout;

function heartbeat() {
  const log = logger.getLogger(MODULE, heartbeat);
  const self = this;
  log.trace('heartbeat');

  pingTimeout && clearTimeout(pingTimeout);

  // Use `WebSocket#terminate()`, which immediately destroys the connection,
  // instead of `WebSocket#close()`, which waits for the close timer.
  // Delay should be equal to the interval at which your server
  // sends out pings plus a conservative assumption of the latency.
  pingTimeout = setTimeout(() => {
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
      log.trace('ascii data: %s', data);
      try {
        let dataObj = JSON.parse(data);
        switch(dataObj.command || dataObj.method) {
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

  ws.on('open', function() {
    heartbeat();
    log.debug('Sending client Id %s', clientId);
    ws.send(JSON.stringify({type: 'clientId', clientId}));
  });
  ws.on('ping', heartbeat);
  ws.on('close', function clear() {
    clearTimeout(this.pingTimeout);
  });

  log.debug('openWs complete');

  return ws;
}

socket = openWs();
