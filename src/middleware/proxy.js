'use strict';

import axios from 'axios';
import {
  Cache, Document,
  cached, notCached, wontCache
} from './cache.js';
import https from 'https';
import logger from 'capn-log';
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

const defaultBackendRequestOptions = {};

let caches = c('caches').map(cache => new Cache(cache.name, cache.pattern));
let backendAgent = new https.Agent({});

const client = axios.create({
  baseURL: c('backend.baseUrl')
});

function httpsOptions(opts) {
  return _.defaults(opts,
      { httpsAgent: backendAgent },
      defaultBackendRequestOptions
    );
}
function request(opts) {
  return client.request(
    httpsOptions(opts)
  );
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
  let path = req.path;
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
      url: path
    })
    .then(clientResponse => {

      let requestedDocument = new Document(
        clientResponse.status,
        clientResponse.headers,
        clientResponse.data
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

    });

  } else {

    log.debug(' --> sending doc from cache');

    sendDocument(res, cachedDocument);

  }
}

export default proxy;
