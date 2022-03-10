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
  const body = req.body;
  let requestId = req.get('x-capnajax-request-id');
  log.debug('called. RequestId: "%s"', requestId);
  let headers = {};
  for (let h of passThroughHeaders) {
    headers[h] = req.get(h);
  }

  log.trace('req %s', req);
  log.trace('headers: %s', headers);
  log.trace('body: %s', body);

  if (_.has(requestsOutstanding, requestId)) {
    requestsOutstanding[requestId](headers, body);
  }

  res.sendStatus(204);
});

export default router;
