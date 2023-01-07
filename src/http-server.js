'use strict'; 

import argv from './args.js';
import app from './express-app.js';
import { promises as fs } from 'fs';
import http from 'http';
import https from 'https';
import logger from 'capn-log';
import { setup as socketSetup } from './socket/server.js';

const MODULE = 'proxy/http-server';

async function startup() {
  const log = logger.getLogger(MODULE, startup);

  // everything that needs to be done before we should start up the HTTP server
  let beforeReadyPromises = [];
  let server;

  let port = global.argv.port;

  let createServer = http.createServer;
  let serverArgs = {};

  // get certificates
  if (global.argv.secure) {
    for (let pem of [
      ['caCertFile', 'ca'],
      ['sslCertFile', 'cert'],
      ['sslKeyFile', 'key']]) {

      if (argv[pem[0]]) {
        createServer = https.createServer;
        let certFiles = argv[pem[0]];
        for (let f of Array.isArray(certFiles) ? certFiles : [certFiles]) {
          log.info('Reading %s file "%s"', pem[1] === 'ca' ? 'ca-cert' : pem[1], f);
          beforeReadyPromises.push(
            fs.readFile(f)
              // FIXME can only handle one ca cert
              .then(buf => { serverArgs[pem[1]] = buf.toString();})
          );
        }
      }
    }
  }

  function onError(error) {
    if (error.syscall !== 'listen') {
      throw error;
    }
  
    // handle specific listen errors with friendly messages
    switch (error.code) {
      case 'EACCES':
        console.error('Port ' + port + ' requires elevated privileges');
        process.exit(1);
      case 'EADDRINUSE':
        console.error('Port ' + port + ' is already in use');
        process.exit(1);
      default:
        throw error;
    }
  }
  
  function onListening() {
    var addr = server.address();
    var bind = typeof addr === 'string'
      ? 'pipe ' + addr
      : 'port ' + addr.port;
    log.info('Listening on ' + bind);
  }
  
  await Promise.all(beforeReadyPromises)
    .then(() => {
      // startup HTTP service
      app.set('port', argv.port);

      server = createServer(serverArgs, app);
      server.listen(port);
      socketSetup(server);
      server.on('error', onError);
      server.on('listening', onListening);    
    });
}

startup();
