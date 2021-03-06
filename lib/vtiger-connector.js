'use strict';

let HttpClient = require('./http');
let SessionToken = require('./session-token');
let CacheSession = require('./cache-session');
let crypto = require('crypto');
let async = require('async');
let assign = require('object.assign');

const logger = require(__dir_class + 'logger-winston');

/**
 *
 * @param dataSource
 * @param callback
 */
exports.initialize = function initializeDataSource(dataSource, callback) {
    let connector = new VtigerConnector(dataSource.settings);

    dataSource.connector = connector;
    dataSource.connector.dataSource = dataSource;

    if (callback) {
        dataSource.connector.connect(callback);
    }
};

class VtigerConnector {

    constructor(settings) {
        this.init = true;
        this.settings = settings || {};
        this.INIT_SESSION_COUNT = settings.countSessionsToInit !== undefined ? settings.countSessionsToInit : 10;
        this.MAX_ATTEMPT_SESSION = 20;
        this.TIME_OUT_BEFORE_NEW_LOGIN_ATTEMPT = 500;
        this.CACHED_VTI_SESSION_NAME = 'vtiSessionName';

        this.http = new HttpClient(settings);
        this.cache = new CacheSession(settings);
        this.sessionToken = new SessionToken(this, settings);
    }

    /**
     *
     * @param next
     */
    connect(next) {
        if (!this.sessionToken.isValid()) {
            this.sessionToken.createToken(next);
        } else {
            if (this.init) {
                this.bulkLogin(this.INIT_SESSION_COUNT, next);
            } else {
                this.login(next);
            }
        }
    }

    get token() {
        return this.sessionToken.getToken().token;
    }

    /**
     *
     * @param next
     */
    login(next) {
        let token = this.token;
        logger.info("[vtiger-connector.login] Login into VTI with token " + token);
        const accessKeyCrypt = VtigerConnector.cryptAccessKey(token, this.settings.password);

        let options = {
            path: 'webservice.php',
            form: {
                username: this.settings.username,
                accessKey: accessKeyCrypt,
                operation: 'login',
            }
        };
        this.http.request(options, (error, result, body) => {
            try {
                const resultJSON = JSON.parse(body);
                if (error === null && resultJSON.success && resultJSON.result && resultJSON.result.sessionName) {
                    this.vtiSessionName = resultJSON.result.sessionName;
                    logger.info("[vtiger-connector.login] Vti session name is " + this.vtiSessionName);
                    this.cache.addSession(this.vtiSessionName);
                    next(null, this.vtiSessionName);
                } else {
                    this.sessionToken.invalidateToken();
                    this.connect(next);
                }
            } catch (e) {
                logger.error('Error login request : ' + error);
                logger.error('Error login message : ' + e.message);
                // next('Error login', null);
            }
        });
    }

    bulkLogin(count, next) {
        let methods = [];
        var sum = 0;
        for (var i = 0, len = count; i < len; i++) {
            methods[i] = (next) => {
                this.login(next);
            };
        }
        async.parallel(methods,
            (err, results) => {
                if (err) {
                    logger.error("[vtiger-connector.bulkLogin] Could not create sessions, error message : " + JSON.stringify(err));
                    next("Could not create sessions");
                } else if (!results || results.length === 0) {
                    logger.error("[vtiger-connector.bulkLogin] Could not create sessions");
                    next("Could not create sessions");
                } else {
                    logger.info("[vtiger-connector.bulkLogin] Sessions created");
                    this.init = false;
                    next(null, results[0]);
                }
            });
    }

    request(session, currentModel, operation, isFile, data, next) {
        let options = {
            path: 'webservice.php',
            form: {
                operation: operation,
                data: data,
                sessionName: session
            },
            time: true
        };
        if (isFile) options.encoding = null;
        this.http.request(options, (error, result, body) => {
            this.notifyObserversOf('after execute', {options, error, response: result});
            this.cache.freeSession(session);
            try {
                if (isFile && !error && result && result.headers && result.headers["content-type"] === 'application/pdf') {
                    return next(null, body, result.headers["content-description"], result.headers["content-disposition"], result.headers["content-length"]);
                }
                const resultJSON = JSON.parse(body);
                let code = result.statusCode;
                if (error === null && resultJSON.success && resultJSON.result) {
                    next(null, resultJSON);
                } else if(!resultJSON.success && resultJSON.error.code !== undefined && resultJSON.error.code === 'INVALID_SESSIONID') {
                    this.cache.removeSession(session);
                    this.getFreeSession((err, session) => {
                        this.request(session, currentModel, operation, isFile, data, next);
                    });
                } else if (!resultJSON.success && resultJSON.error) {
                    throw new Error("[" + currentModel + "][vtiger-connector.request] error code : " + resultJSON.error.code + "\n error message : " + resultJSON.error.message);
                } else {
                    throw new Error("[" + currentModel + "][vtiger-connector.request] error : " +error);
                }
            } catch (e) {
                if (e instanceof SyntaxError) {
                    logger.error('[' + currentModel + '][vtiger-connector.request] request error message: ' + e.message + ' - operation: ' + operation +' - data: '+JSON.stringify(data)+' - session: '+session + ' - raw body: ' + body);
                } else {
                    logger.error('[' + currentModel + '][vtiger-connector.request] request error message: ' + e.message + ' - operation: ' + operation +' - data: '+JSON.stringify(data)+' - session: '+session);
                    logger.error('[' + currentModel + '][vtiger-connector.request] request error message: ' + e.message);
                }
                next(e, result);
            }
        });
    }

    getFreeSession(next) {
        async.retry(
            {
                times: this.MAX_ATTEMPT_SESSION,
                interval: this.TIME_OUT_BEFORE_NEW_LOGIN_ATTEMPT
            },
            (callback) => {
                this.cache.getAvailableSession((toUse) => {
                    if (toUse !== null) {
                        callback(null, toUse);
                    } else {
                        this.connect(callback);
                    }
                });
            },
            (err, session) => {
                if (err === null) {
                    next(null, session);
                } else {
                    logger.error("[vtiger-connector.getFreeSession] too much attempts for this function. Error : " + JSON.stringify(err));
                    next('Error authenticate', null);
                }
            }
        );
    }

    getFile(options, data, next) {
        options.isFile = true;
        this.sendRequest(options, data, next);
    }

    sendRequest(options, data, next) {
        if (!options || !options.currentModel || !options.operationMethod) {
            const error = new Error("[vtiger-connector.sendRequest] missing options, it should contain at least 'currentModel' and 'operationMethod'");
            logger.error(error.message);
            return next(e, null);
        }
        data = JSON.stringify(data);
        this.getFreeSession((err, session) => {
            this.request(session, 
                options.currentModel, 
                VtigerConnector.getOperation(this, options.currentModel) + "." + options.operationMethod, 
                options.isFile, 
                data,
                next);
        });
    }

    /**
     *
     * @param currentModel
     * @param where
     * @param next
     */
    all(currentModel, where, next) {
        let data = JSON.stringify(VtigerConnector.buildDataFilter(where));
        this.getFreeSession((err, session) => {
            this.request(session, currentModel, VtigerConnector.getOperation(this, currentModel) + '.find', false, data, next);
        });

    }

    /**
     *
     * @param currentModel
     * @param data
     * @param params
     * @param next
     */
    create(currentModel, data, params, next) {
        data = JSON.stringify(data);
        this.getFreeSession((err, session) => {
            this.request(session, currentModel, VtigerConnector.getOperation(this, currentModel) + '.create', false, data, next);
        });

    }

    static buildDataFilter(filter) {
        let returnFilter = {};
        const filterWhere = filter.where === undefined ? {} : filter.where;

        if (!filterWhere.and) {
            returnFilter = filterWhere;
        } else {
            filterWhere.and.forEach(function (itemFilter) {
                returnFilter = assign(returnFilter, itemFilter);
            });
        }
        return returnFilter;
    }

    static getOperation(connector, model) {
        return connector.dataSource.modelBuilder.models[model].definition.settings.vtiOperation;
    }

    static cryptAccessKey(token, password) {
        return crypto.createHash('md5').update(token + password).digest("hex");
    }
}