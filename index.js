'use strict';

import argv from './src/args.js';

if (argv.isClient) {
  import('./src/socket/client.js');
} else {
  import('./src/http-server.js');  
}

