'use strict';

import Parser from 'args-and-envs';
import fs from 'fs';
import logger from 'capn-log';
import path from 'path';
import Config from 'per-env-config';
import YAML from 'yaml';
import _ from 'lodash';

const MODULE = 'proxy/args';

function doParse() {
  let log = logger.getLogger(MODULE, 'doParse');

  const argvDefinitions = [
    { name: 'configEnv',
      arg: ['--env'],
      env: 'CONFIG_ENV',
      required: false
    },
    { name: 'configFiles',
      arg: ['--config', '-c'],
      env: 'CONFIG_FILES',
      required: true,
      type: 'list'      
    },
    { name: 'port',
      arg: [ '--port', '-p' ],
      env: 'PORT',
      type: 'integer',
      default: 3000
    }];

  const handlers = {
    configFiles: (v, ar) => {
      v = _.flatten(_.map(v, p => p.split(path.delimiter)));
      let loggerConfigs = [];
      let configConfigs = [];
      for (let filename of v) {
        let json = YAML.parse(fs.readFileSync(filename).toString());
        configConfigs.push(json);
        if (_.has(json, 'default.debug')) {
          loggerConfigs.push(_.pick(json.default, 'debug'));
        }
        if (_.has(ar, 'configEnv') && _.has(json, 'environments')) {
          let envConfig = _.find(json.environments, {name: ar.configEnv})
          if (_.has(envConfig, 'debug')) {
            loggerConfigs.push(_.pick(envConfig, 'debug'));
          }
        }
      }

      logger.setConfigs(loggerConfigs);
      log = logger.getLogger(MODULE, 'doParse');
      log.info('Using config files %s for logging', v);
      log.info('Using configs %s for logging', JSON.stringify(loggerConfigs));
      log.info('info');
      log.debug('debug');
      log.trace('trace');

      log.info('Using configs %s for config', JSON.stringify(configConfigs));
      log.info('Using env %s for config', JSON.stringify(ar.configEnv));

      let config = new Config({configs: configConfigs, env: ar.configEnv});
      global.config = config.bind();

      return v;
    }
  };

  let parser = new Parser(argvDefinitions, {handler: handlers});
  parser.parse();

  if (parser.errors) {
    for (let err of parser.errors) {
      log.error('%s', err);
    }
  }

  log.info('argv: §%s§', parser.argv);
  return parser;
}
let parser = doParse();

export { parser };
export default parser.argv;
