'use strict';

import logger from 'capn-log';
import { requestsOutstanding } from '../socket/server.js';
import { Router } from "express";
import _ from 'lodash';

const MODULE = 'proxy/receiver';

const router = Router();

const passThroughHeaders = [
  'x-capnajax-status', 'x-capnajax-statusText',
  'content-type', 'content-length',
  'x-capnajax-request-id', 'x-capnajax-path'
];

router.put('/', (req, res) => {
  const log = logger.getLogger(MODULE, 'PUT', '/');
  let requestId = req.get('x-capnajax-request-id');
  log.debug('called. RequestId: "%s"', requestId);
  let headers;
  for (let h of passThroughHeaders) {
    headers[h] = req.get(h);
  }

  if (_.has(requestsOutstanding, requestId)) {
    requestsOutstanding[requestId](headers, req.data);
  }

  res.sendStatus(204);
});

export default router;
