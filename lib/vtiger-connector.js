'use strict';

let HttpClient = require('./http');
let SessionToken = require('./session-token');
let CacheSession = require('./cache-session');
let crypto = require('crypto');
let async = require('async');
let assign = require('object.assign');

const LoggerWinston = require(__dir_class + 'logger-winston');
const logger = new LoggerWinston();

let sessionsLoaded = false;

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
        this.init = false;
        let methods = [];
        var sum = 0;
        for (var i = 0, len = count; i < len; i++) {
            methods[i] = (next) => {
                this.login(next);
            };
        }
        async.parallel(methods,
            (err, results) => {
                logger.info("[vtiger-connector.bulkLogin] Sessions created");
                sessionsLoaded = true;
                next();
            });
    }

    request(session, currentModel, operation, data, next) {
        let options = {
            path: 'webservice.php',
            form: {
                operation: operation,
                data: data,
                sessionName: session
            }
        };
        this.http.request(options, (error, result, body) => {
            this.cache.freeSession(session);
            try {
                const resultJSON = JSON.parse(body);
                let code = result.statusCode;
                if (error === null && resultJSON.success && resultJSON.result) {
                    next(null, resultJSON);
                } else if(!resultJSON.success && resultJSON.error.code !== undefined && resultJSON.error.code === 'INVALID_SESSIONID') {
                    this.cache.removeSession(session);
                    this.getFreeSession((err, session) => {
                        this.request(session, currentModel, operation, data, next);
                    });
                } else {
                    throw new Error("[" + currentModel + "][vtiger-connector.request] error : " +error);
                }
            } catch (e) {
                logger.error('[' + currentModel + '][vtiger-connector.request] request error : ' + error);
                logger.error('[' + currentModel + '][vtiger-connector.request] request error message: ' + e.message);
                next(e, null);
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
                if (!sessionsLoaded) {
                    callback('Sessions not initialized');
                } else {
                    this.cache.getAvailableSession((toUse) => {
                        if (toUse !== null) {
                            callback(null, toUse);
                        } else {
                            this.connect(callback);
                        }
                    });
                }
            },
            (err, session) => {
                if (err === null) {
                    next(null, session);
                } else {
                    logger.error("[vtiger-connector.getFreeSession] too much attempts for this function");
                    next('Error authenticate', null);
                }
            }
        );
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
            this.request(session, currentModel, VtigerConnector.getOperation(this, currentModel) + '.find', data, next);
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

        this.getFreeSession((err, session) => {
            this.request(currentModel, VtigerConnector.getOperation(this, currentModel) + 'create', data, next);
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