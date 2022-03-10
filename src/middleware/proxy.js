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

function request({method, path}) {
  const log = logger.getLogger(MODULE, request);
  log.trace('Making request to "%s"', {method, path});

  let docPromise = requestDocument({method, path});




  // TODO



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
  log.trace('filteredHeders: %s', document.headers);

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
  
  log.debug(' --> cache %s', cachedDocument instanceof Symbol ? cachedDocument : 'document found');

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

      docHeaders['content-type'] =
        clientResponse.headers['x-capnajax-content-type'];
      delete clientResponse.headers['x-capnajax-content-type'];

      let requestedDocument = new Document(
        clientResponse.headers['x-capnajax-status'],
        docHeaders,
        clientResponse.doc
      );

      log.trace(' --> requestedDocument: %s', requestedDocument);

      requestedDocument.filterHeaders(
        _.has(passThroughHeaders, requestedDocument.status)
        ? _.get(passThroughHeaders, requestedDocument.status)
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
