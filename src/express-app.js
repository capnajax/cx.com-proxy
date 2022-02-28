
import express from 'express';
import morganLogger from 'morgan';
import proxy from './middleware/proxy.js';
import receiver from './middleware/receiver.js';
import logger from 'capn-log';

const MODULE='proxy/express-app';
const log = logger.getLogger(MODULE, '*');

const app = express();

app.use(morganLogger('dev'));

app.use('/', proxy);
app.use(new RegExp('^/([^_].*)?'), proxy);
app.use('_content', receiver);

app.use((req, res, next) => {
  const log = logger.getLogger(MODULE, '404');
  log.info('No pattern for %s %s', req.method, req.path);
  res.status(404).send(`No pattern for ${req.method} ${req.path}`);
});

log.info('Started express app');

export default app;