'use strict';

import argv from '../args.js';
import cryptoRandomString from 'crypto-random-string';
import http from 'http';
import https from 'https';
import { promises as fs, readFileSync } from 'fs';
import logger from 'capn-log';
import path from 'path';
import { WebSocket } from 'ws';
import _ from 'lodash';

const MODULE = 'proxy/ws-client';
const PROTOCOL = 'cxproxy';
const c = global.config;

const forwardableHeaders = c('proxy.forwardHeaders');

let socket;

const clientId = cryptoRandomString({length: 32, type: 'alphanumeric'})
let caCerts = _.has(global.argv, 'caCertFile')
  ? (() => {
      const caCertParm = _.get(global.argv, 'caCertFile')
      const cac = Array.isArray(caCertParm) ? caCertParm : [caCertParm];
      let result = [];
      for (let caci of cac) {
        for (let cacij of caci.split(path.delimiter)) {
          result.push(readFileSync(cacij));
        }
      }
    })()
  : undefined;
let sslCert = _.has(global.argv, 'sslCertFile')
  ? readFileSync(global.argv.sslCertFile).toString()
  : undefined;
let sslKey = _.has(global.argv, 'sslKeyFile')
  ? readFileSync(global.argv.sslKeyFile).toString()
  : undefined;

/**
 * @function backendClientOpts
 * Create options to use for connecting to the backend server
 */
function backendClientOpts(opts) {
  const log = logger.getLogger(MODULE, 'backendClientOpts');

  let result = _.extend({
    ca: caCert,
    cert: sslCert,
    key: sslKey,
    host: c('backend.host'),
    port: c('backend.port'),
    timeout: 1000
  }, opts);

  log.trace('result: %s', result);

  return result;
}

/**
 * @function uplinkClientOpts
 * Create options to use for connecting to the proxy server
 */
function uplinkClientOpts(opts) {
  const log = logger.getLogger(MODULE, 'uplinkClientOpts');

  const insecure = !!c('security.insecure');
  insecure && log.warn('insecure certificates enabled');
  log.trace('insecure: "%s"', insecure);

  let result = _.extend({
    ca: caCerts,
    cert: sslCert,
    key: sslKey,
    rejectUnauthorized: !insecure,
    timeout: 1000
  }, opts);

  log.trace('result: %s', result);

  return result;
}

/**
 * @function clientPutProxy
 * Make a request to the back-end and send the results in a post to the front
 * end.
 * @param {String} method the http method to use to request from the back end
 * @param {String} path the path of the data to request
 * @param {Object} frontendOptions options for the front end. Required.
 * @param {String} frontendOptions.requestId the requestID to include in the
 *  `x-capnajax-request-id` header.
 * @param {Object} [backendOptions] other options for the backend request
 * @param {String} [backendOptions.contentType] the content type of the request
 *  body. Ignored if the request does not have a body. Default:
 * 'application/x-www-form-urlencoded'
 * @param {Buffer} [backendOptions.body] the requst body.
 */
function clientPutProxy(method, path, frontendOptions, backendOptions) {
  const log = logger.getLogger(MODULE, clientPutProxy);
  log.debug('Making backend %s request to %s', method.toUpperCase(), path);

  backendOptions || (backendOptions = {});
  let clientOptions = backendClientOpts(
    _.extend({}, backendOptions.clientOptions || {}, {
      path
    })
  );

  log.debug(' --> %s %s setting up uplink', method.toUpperCase(), path);

  const uplinkOpts = uplinkClientOpts({
    method: 'PUT',
    hostname: argv.frontSide,
    path: '/_content'
  });

  // uplink with headers
  let uplink = null;
  // stores chunks until ready to send them.
  let chunks = [];

  let writeUplink = (chunk) => {
    if (chunk) {
      log.debug(' --> %s %s queueing chunk', method.toUpperCase(), path);
      chunks && chunks.push(chunk);
    }
    if (uplink && chunks) {
      while(chunks.length) {
        log.debug(' --> %s %s writing chunk', method.toUpperCase(), path);
        let writeChunk = chunks.shift();
        log.trace('Chunk: %s', writeChunk);
        uplink.write(writeChunk);
      }
    }
  }

  const backendRequest = http.request(clientOptions);
  log.debug(' --> %s %s made backend request', method.toUpperCase(), path);
  //backendRequest.setNoDelay(true);
  //log.debug(' --> %s %s set nodelay', method.toUpperCase(), path);

  backendRequest.on('response', message => {
    log.debug(' --> %s %s got response', method.toUpperCase(), path);

    // build the request to the backend
    let headers = {};
    for (let i = 0; i < message.rawHeaders.length; i += 2) {
      let key = message.rawHeaders[i].toLowerCase();
      let value = message.rawHeaders[i+1];

      log.trace(' --> --> header() %s: %s', forwardableHeaders.includes(key) ? 'included' : 'not included', key, value);

      if (forwardableHeaders.includes(key)) {
        headers[key] = value;
      } else {
        // any preprocessing of headers here
        switch(key) {

        default:
          // do nothing -- do not include headers that aren't whitelisted
        }
      }
    }
    _.extend(headers, {
      'x-capnajax-method': method,
      'x-capnajax-status': message.statusCode,
      'x-capnajax-status-text': message.statusMessage,
      'x-capnajax-request-id': frontendOptions.requestId,
      'x-capnajax-path': path        
    });

    uplinkOpts.headers = headers;
    log.trace('uplinkOpts.headers: %s', uplinkOpts.headers);
    uplink = https.request(uplinkOpts);

  });

  backendRequest.on('data', chunk => {
    writeUplink(chunk);
  });

  backendRequest.on('end', () => {
    log.debug(' --> %s %s client response end', method.toUpperCase(), path);
    writeUplink();
    uplink && uplink.end();
    log.debug(' --> %s %s uplink complete', method.toUpperCase(), path);
    uplink = null;
  });

  backendRequest.on('error', reason => {
    log.debug(' --> %s %s ERROR: %s', method.toUpperCase(), path, reason);
    uplink && uplink.destroy();
    uplink = null;
  });

  backendRequest.end(() => {
    log.debug(' --> %s %s end', method.toUpperCase(), path);
  });
}

function httpGet(dataObj) {
  const log = logger.getLogger(MODULE, httpGet);
  log.trace('%s', dataObj);

  const url = dataObj.path;
  log.info('GET %s', url);

  clientPutProxy(
    'GET',
    dataObj.path,
    { requestId: dataObj.requestId }
  );

  // for (let i of ['path', 'requestId']) {
  //   if (!_.has(dataObj, i)) {
  //     throw `\`get\` dataObj missing required value for "${i}"`;
  //   }
  // }

  



  // // make HTTP client request
  // axios.get(url)
  //   .then(response => {

  //     log.trace('response: %s', response);
  //     log.trace('response.headers: %s', response.headers);



  //     // TODO response.data isn't always a stream. axios wants to parse some
  //     // content types. Ditch axios and use a raw http client


  //     let dataBuffer = Buffer.from(response.data);
  //     // post result to server
  //     let forwardHeaders = {
  //       'x-capnajax-status': response.status,
  //       'x-capnajax-statusText': response.statusText,
  //       'x-capnajax-content-type': response.headers['content-type'],
  //       'content-type': 'application/octet-stream',
  //       'content-length': dataBuffer.length,
  //       'x-capnajax-request-id': dataObj.requestId,
  //       'x-capnajax-path': dataObj.path
  //     };

  //     log.trace('forwardHeaders: %s', forwardHeaders);

  //     let putOptions = proxyClientOpts({
  //       method: 'PUT',
  //       headers: forwardHeaders,
  //       url: `https://${argv.frontSide}/_content`
  //     });

  //     let uplink = axiosUplink();

  //     log.trace('Got response, POSTing with headers %s', putOptions.headers);
  //     putOptions.data = dataBuffer;

  //     uplink(putOptions)
  //       .then(response => {
  //         log.trace('POSTed.');
  //         log.trace('Status %s', response.status);
  //         if (response.status >= 400) {
  //           console.error('Got error %s responding to GET (%s) %s',
  //             response.status, dataObj.requestId, dataObj.path);
  //         }
  //       })
  //       .catch(e => {
  //         log.error('failed upload response: %s', e);
  //       });
  //   });
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

  const proxyOpts = uplinkClientOpts({});

  log.debug('creating WebSocket');

  const ws = new WebSocket(
    `wss://${argv.frontSide}/proxy`, 
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

  ws.on('error', function(reason) {
    log.error('Error in socket: %s', reason);
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
