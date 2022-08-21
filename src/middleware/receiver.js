'use strict';

import logger from 'capn-log';
import { requestsOutstanding } from '../socket/server.js';
import { Router } from "express";
import _ from 'lodash';

const MODULE = 'proxy/receiver';

const router = Router();

const passThroughHeaders = [
  'x-capnajax-status', 'x-capnajax-statusText', 'x-capnajax-content-type',
  'content-type', 'content-length',
  'x-capnajax-request-id', 'x-capnajax-path'
];

router.put('/', (req, res) => {
  const log = logger.getLogger(MODULE, 'PUT', '/');

  let chunks = [];
  let chunkSizes = [];

  // pull data by hand so expressjs doesn't try to parse it.
  req.on('data', chunk => {
    log.trace('GOT CHUNK: (%s)', Buffer.isBuffer(chunk) ? 'Buffer' : typeof(chunk));
    chunks.push(chunk);
    chunkSizes.push( chunk.length );
  });

  req.on('end', () => {
    const body = Buffer.concat(chunks);

    let requestId = req.get('x-capnajax-request-id');
    log.debug('called. RequestId: "%s"', requestId);
    let headers = {};
    for (let h of passThroughHeaders) {
      if (req.get(h)) {
        headers[h] = req.get(h);
      }
    }
  
    log.trace('headers: %s', headers);
    log.trace('length: %s', _.sum(chunkSizes));
    log.trace('body.length: %s', body.length);
  
    if (_.has(requestsOutstanding, requestId)) {
      requestsOutstanding[requestId](headers, body);
    }
  
    res.sendStatus(204);
  
  });

});

export default router;
