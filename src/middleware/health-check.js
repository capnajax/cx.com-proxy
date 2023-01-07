'use strict';

import logger from 'capn-log';
import { Router } from "express";

const MODULE = 'proxy/healthCheck';
const router = Router();

const log = logger.getLogger(MODULE, '*');
log.info('Starting healthz module');

router.get('/', (req, res) => {
  const log = logger.getLogger(MODULE, 'get', '/');
  log.info('called');
  log.debug('called');
  res.sendStatus('204');
});

export default router;
