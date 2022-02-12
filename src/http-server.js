'use strict'; 

import argv from './args.js';
import app from './express-app.js';
import { createServer } from 'https';
import logger from 'capn-log';

const MODULE = 'proxy/http-server';

async function startup() {
  const log = logger.getLogger(MODULE, startup);

  // everything that needs to be done before we should start up the HTTP server
  let beforeReadyPromises = [];
  let server;

  let port = global.argv.port;

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

      log.trace('app: %s', app);

      // server = createServer(app);
      app.listen(port);
      // server.on('error', onError);
      // server.on('listening', onListening);    
      app.on('error', onError);
      app.on('listening', onListening);    
    });
}

startup();
