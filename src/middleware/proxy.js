'use strict';

import {
  Cache, Document,
  cached, notCached, wontCache
} from './cache.js';
import logger from 'capn-log';
import { requestDocument } from '../socket/server.js';
import _ from 'lodash';

const MODULE = 'proxy/proxy';

const c = global.config;
const passThroughHeaders = {
  304: [
    'cache-control', 'content-location', 'date', 'etag', 'expires', 'vary'
  ],
  default: [
    'cache-control', 'content-location', 'date', 'etag', 'expires', 'vary',
    'location', 'content-type', 
  ]
}

let caches = c('caches').map(cache => new Cache(cache.name, cache.pattern));

const specialPaths = {
  '/content/last-update': {
    get: function(headers, body) {
      let log = logger.getLogger(MODULE, 'special:/content/last-update');
      log.trace('headers[\'content-type\'] == %s', headers['content-type']);
      if (headers['x-capnajax-status'] == 200) {
        let bodyObj = JSON.parse(body);
        let lastUpdate = bodyObj['last-update'];

        setTimeout(() => {
          log.trace('checking caches for ims:');
          for (let cache of caches) {
            log.trace(
              '--> lastUpdate: %s, cache.ims: %s', lastUpdate, cache.ims);
            cache.clear();
          }            
        }, 10);


      }
    }
  }
}

function request({method, path}) {
  const log = logger.getLogger(MODULE, request);
  log.info('Making request to "%s"', {method, path});

  // test cache, request doc, and resolve with doc
  let docPromise = requestDocument({method, path});

  // test for special handling
  let special = specialPaths[path];
  special && (special = special[method]);
  if (special) {
    docPromise.then(doc => {

      log.debug('%s %s is a special path', method, path);
      log.trace('doc: %s', doc);
      log.trace('doc.headers: %s', doc.headers);
      log.trace('doc.doc: %s', doc.doc.toString());
      // TODO use the doc to call the special function

      special(doc.headers, doc.doc.toString());

    }).catch(e => {
      log.error('request error: %s', e);
    });
  } else {
    log.trace('%s %s is NOT a special path', method, path);
  }

  return docPromise;

}

/**
 * @function isCacheable
 * Calculate if the document should be cached at all based on the status code
 * and the headers.
 * @param {Document} document 
 * @returns 
 */
function isCacheable(document) {
  return true;
}

function sendDocument(res, document) {
  const log = logger.getLogger(MODULE, sendDocument);

  log.trace('sendDocument called on document %s', document);
  log.trace('filteredHeaders: %s', document.headers);

  // return result
  for (let h of Object.keys(document.headers)) {
    res.set(h, document.headers[h]);
  }

  res.status(document.statusCode).send(document.body);

}

function proxy(req, res, next) {
  
  const log = logger.getLogger(MODULE, proxy);

  let verb = req.method;
  let path =req.originalUrl;
  let ims = req.get('If-Modified-Since') || null;

  log.debug('proxying %s %s', verb, path);

  let cachedDocument = wontCache;
  for (let i = 0; i < caches.length && cachedDocument === wontCache; i++) {
    // this loop exits if the cache WOULD cache that path, even if it hasn't
    // actually cached it.
    cachedDocument = caches[i].get(verb, path, ims);
  }
  
  log.debug(' --> cachedDocument: %s', cachedDocument);

  if (
    cachedDocument === wontCache ||
    cachedDocument === notCached) {

    log.debug(' --> requesting doc from backend');

    // make request
    request({
      method: verb.toLowerCase(),
      path
    })
    .then(clientResponse => {

      log.trace(' --> clientResponse: %s', clientResponse);
      log.trace(' --> clientResponse.headers: %s', clientResponse.headers);

      let docHeaders = { ... clientResponse.headers };

      let requestedDocument = new Document(
        clientResponse.headers['x-capnajax-status'],
        docHeaders,
        clientResponse.doc
      );

      log.trace(' --> requestedDocument: %s', requestedDocument);
      log.trace(' --> requestedDocument.statusCode: %s', requestedDocument.statusCode);

      requestedDocument.filterHeaders(
        _.has(passThroughHeaders, requestedDocument.statusCode)
        ? _.get(passThroughHeaders, requestedDocument.statusCode)
        : passThroughHeaders.default
      );

      log.debug(' --> sending doc to client');

      sendDocument(res, requestedDocument);

      log.debug(' --> cacheing document');

      // cache results
      if(isCacheable(requestedDocument)) {
        let cachedDocument = wontCache;
        for (let i = 0; i < caches.length && cachedDocument === wontCache; i++) {
          // this loop exits if the cache WOULD cache that path
          cachedDocument = caches[i].set(verb, path, requestedDocument);
        }      
      }

      log.debug(' --> done');

    })
    .catch(reason => {
      log.error(' --> FAILED: %s', reason);
      next();
    });

  } else {

    log.debug(' --> sending doc from cache');

    sendDocument(res, cachedDocument);

  }
}

proxy.caches = caches;

export default proxy;
