'use strict';

import _ from "lodash";
import logger from 'capn-log';

const MODULE = 'proxy/cache';

/**
 * Used to indicate that this cache would normally cache that path key but
 * does not have that item.
 */
const notCached = Symbol('NOT_CACHED');

/**
 * Used to indicate that this path has successfully been cached
 */
const cached = Symbol('CACHED');

/**
 * Used to indicate that this cache cannot cached that path because it is
 * forbidden, i.e. the path provided does not match the `cache.pattern`.
 */
const wontCache = Symbol('WONT_CACHE');

class Document {
  constructor(statusCode, headers, body) {
    this.statusCode = statusCode;
    // TODO add cache-control header handling 
    this.headers = headers || [];
    this.body = body;
  }

  addHeader(header) {
    this.headers.push(header);
  }

  clone(statusCode) {
    return new Document(
      statusCode || this.statusCode,
      this.headers,
      this.body
    );
  }

  filterHeaders(passThroughHeaders) {
    this.headers = _.pick(this.headers, passThroughHeaders);
  }

  getHeaders(name) {
    const log = logger.getLogger(MODULE, 'Document.getHeaders');
    log.trace('this.headers: %s', this.headers);
    let result = this.headers.filter(
      header => {
        let result = (name === header.replace(/:.*/, ''));
        log.trace(' --> header %s, result %s', header, result);
        return result;
      });
    return result;
  }

  getHeaderValues(name) {
    const log = logger.getLogger(MODULE, 'Document.getHeaderValues');
    log.trace('this.headers: %s', this.headers);
    let result = this.getHeaders(name).map(
      header => {
        let result = header.replace(/[^:]*:/, '');
        log.trace(' --> header %s, result %s', header, result);
        return result;
      });
    return result;
  }
}

class Cache {
  constructor(name, pattern) {
    this.name = name;
    this.pattern = pattern 
      ? (pattern instanceof RegExp ? pattern : new RegExp(pattern))
      : null;
    this.ims = Date.now();
    this.documents = {};
  }

  #key(verb, path) {
    if (!this.pattern || this.pattern.test(path)) {
      return `${verb.toUpperCase()} ${path}`;
    } else {
      return wontCache;
    }
  }

  clear() {
    const log = logger.getLogger(MODULE, 'Cache.clear');
    log.info('Clearing cache');
    this.ims = Date.now();
    this.documents = {};
  }

  get(verb, path, ims) {
    let key = this.#key(verb, path);
    if (key !== wontCache) {
      if (ims !== null && typeof ims === 'object') {
        ims = ims.valueOf();
      } else if (typeof ims === 'string' ) {
        // can handle both ISO 8601 and RFC2616 date formats.
        ims = Date.parse(ims);
      }

      let cachedDocument = _.has(this.documents, key)
        ? _.get(this.documents, key)
        : notCached;

      if (cachedDocument !== notCached && 
          ims && (typeof ims === 'number') && ims > this.ims) {
        // no change since ims; just tell client there is no change
        // certain headers are still necessary, so we still need the cached
        // document
        return cachedDocument.clone(304);
      } else {
        return cachedDocument === notCached
          ? notCached
          : cachedDocument.clone();
      }
    } else {
      return wontCache;
    }
  }

  set(verb, path, document) {
    let key = this.#key(verb, path);
    // if (document.getHeaders('cache-control')) {
    //   return wontCache;
    // }
    if (key !== wontCache) {
      this.documents[key] = document;
      return cached;
    } else {
      return wontCache;
    }
  }
}

export {
  Cache,
  Document,
  cached,
  notCached,
  wontCache
};
