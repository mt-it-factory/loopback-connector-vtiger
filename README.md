# loopback-connector-vtiger

The VTIGER connector enables LoopBack applications to interact with
[VTIGER](https://www.vtiger.com/) tunnel API.

## IMPORTANT !

This module is in development ! But he's working !


## Installation

In your application root directory, enter:

```shell
$ npm install loopback-connector-vtiger --save
```

This will install the module from npm and add it as a dependency to the application's 
[package.json](http://loopback.io/doc/en/lb2/package.json.html) file.

## Example datasource.json 

A complete example datasource.json:

```javascript
"vtiger": {
  "host": "http://vti.localhost.mc",
  "port": 80,
  "username": "loopback",
  "password": "password",
  "name": "vtiger",
  "connector": "vtiger",
  "crud": false,
  "operations": {},
  "loggerPath" : "server/app/logger.js",
  "countSessionsToInit": 1
}
```



## Example logger.js

A complete example of logger, splitted in two parts :

```javascript
const LoggerWinston = require(__dir_class + 'logger-winston');
let logger = new LoggerWinston();

exports.info = function (message) {
    logger.info(message);
};

exports.error = function (message) {
    logger.error(message);
};

exports.warn = function (message) {
    logger.warn(message);
};

exports.track = function (message) {
    logger.track(message);
};
```

And logger-winston.js


```javascript
/**
 * Created by g.just on 21/02/2017.
 */
const winston = require('winston');
const mkdirp = require('mkdirp');
require('winston-daily-rotate-file');

const app = require('../server.js');
let config = app.get('winston');

if (!config) {
    throw new Error('Config Winston not found');
}

mkdirp(config.filePath);
console.log('Winston logger level : ' + config.logLevel);

class LoggerWinston {
    constructor() {
        let levels = {
            levels: {
                error: 0,
                important: 1,
                request: 2,
                warn: 3,
                info: 4,
                verbose: 5,
                debug: 6,
                silly: 7
            },
            colors: {
                error: 'red',
                important: 'orange',
                request: 'green',
                warn: 'orange',
                info: 'blue',
                verbose: 'blue',
                debug: 'blue',
                silly: 'blue'
            }
        };

        //With log rotate
        if (config.datePattern !== "") {
            this.transport = new winston.transports.DailyRotateFile({
                filename: config.filePath + config.fileName,
                datePattern: config.datePattern,
                prepend: true,
                level: config.logLevel
            });
        } else {
            this.transport = new (winston.transports.File)({
                name: 'logfile',
                filename: config.filePath + config.fileName,
                level: config.logLevel,
            });
        }

        this.logger = new (winston.Logger)({
            transports: [
                this.transport
            ],
            meta: true,
            levels: levels.levels
        });
    }

    track(message, meta = null) {
        console.info("[" + new Date().dateTime() + "][TRACK]" + message);
        this.logger.log('debug', message, meta);
    }

    info(message, meta = null) {
        console.info("[" + new Date().dateTime() + "][INFO]" + message);
        this.logger.log('info', message, meta);
    }

    error(message, meta = null) {
        console.error("[" + new Date().dateTime() + "][ERROR]" + message);
        this.logger.log('error', message, meta);
    }

    warn(message, meta = null) {
        console.warn("[" + new Date().dateTime() + "[WARN]" + message);
        this.logger.log('warn', message, meta);
    }

    important(message, meta = null) {
        console.info("[" + new Date().dateTime() + "[IMPORTANT]" + message);
        this.logger.log('important', '[IMPORTANT]'+message, meta);
    }

    request(message, meta = null) {
        console.info("[" + new Date().dateTime() + "[REQUEST]" + message);
        this.logger.log('request', '[REQUEST]'+message, meta);
    }
}

module.exports = LoggerWinston;
```