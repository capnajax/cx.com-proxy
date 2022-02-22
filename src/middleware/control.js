'use strict';

import logger from 'capn-log';
import { Router } from 'express';

import _ from 'lodash';

const MODULE = 'proxy/control';

// const config = Config.fromArgsSync();
// const c = config.bind();

const router = Router();

router.post('/clear/:cacheName', async (req, res, next) => {
  
});

router.get('/articles', async (req, res, next) => {
});

router.get('/article/:permalink/*', async (req, res, next) => {

  // respond with to /posted/:permlink/:0

  res.header('Location', `/posted/${req.params.permalink}/${req.params[0]}`);
  res.sendStatus(302);
});

export default router;
