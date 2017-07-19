'use strict';

const HttpClient = require('./http');
const SessionToken = require('./session-token');
const Crypto = require('crypto');
const CacheSession = require('./cache-session');
const async = require('async');
const Assign = require('object.assign');
/**
 *
 * @param dataSource
 * @param callback
 */
exports.initialize = function initializeDataSource(dataSource, callback) {
    let connector = new VtigerConnector(dataSource.settings);

    dataSource.connector = connector;
    dataSource.connector.dataSource = dataSource;

    connector.connect(callback, dataSource);

};

class VtigerConnector {

    constructor(settings) {
        this.INIT_SESSION_COUNT = 2; // TODO : put it in datasource settings

        this.cachedVtiSessionName = 'vtiSessionName';

        this.settings = settings || {};
        this.Http = new HttpClient(settings);
        this.cache = new CacheSession(settings);
        this.Log = require(settings.loggerPath);
        this.init = true;

        this.MAX_ATTEMPT_SESSION = 10;
        this.TIME_OUT_BEFORE_NEW_LOGIN_ATTEMPT = 300;

        this.VtigerSessionToken = new SessionToken(this, settings);
    }

    /**
     *
     * @param next
     */
    connect(next) {
        if (!this.VtigerSessionToken.isValid()) {
            this.VtigerSessionToken.createToken(next);
        } else {
            if (this.init) {
                this.bulkLogin(this.INIT_SESSION_COUNT, next);
            } else {
                this.login(next);
            }
        }
    }

    /**
     *
     * @param next
     */
    login(next) {
        let token = this.VtigerSessionToken.getToken().token;
        this.Log.info("[vtiger-connector.login] Login into VTI with token " + token);
        const accessKeyCrypt = cryptAccessKey(token, this.settings.password);

        let options = {
            path: 'webservice.php',
            form: {
                username: this.settings.username,
                accessKey: accessKeyCrypt,
                operation: 'login',
            }
        };
        this.Http.request(options, (error, result, body) => {
            try {
                const resultJSON = JSON.parse(body);
                if (error === null && resultJSON.success && resultJSON.result && resultJSON.result.sessionName) {
                    this.vtiSessionName = resultJSON.result.sessionName;
                    this.Log.info("[vtiger-connector.login] Vti session name is " + this.vtiSessionName);
                    this.cache.addSession(this.vtiSessionName);
                    next(null, this.vtiSessionName);
                } else {
                    this.VtigerSessionToken.invalidateToken();
                    this.connect(next);
                }
            } catch (e) {
                this.Log.error('Error login request : ' + error);
                this.Log.error('Error login message : ' + e.message);
                next('Error login', null);
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
        this.Http.request(options, (error, result, body) => {
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
                    this.Log.info("[" + currentModel + "][vtiger-connector.all] request error : " + error);
                    this.Log.info("[" + currentModel + "][vtiger-connector.all] request : " + data);
                    next('Error request', null);
                }
            } catch (e) {
                this.Log.error('[' + currentModel + '][vtiger-connector.all] request error : ' + error);
                this.Log.error('[' + currentModel + '][vtiger-connector.all] request error message: ' + e.message);
                next('Error request', null);
            }
        });
    }

    getFreeSession(next) {
        async.retry(
            {
                times: this.MAX_ATTEMPT_SESSION,
                interval: this.TIME_OUT_BEFORE_NEW_LOGIN_ATTEMPT
            },
            (next) => {
                this.cache.getAvailableSession((toUse) => {
                    if (toUse !== null) {
                        next(null, toUse);
                    } else {
                        this.connect(next);
                    }
                });
            },
            (err, session) => {
                if (!err) {
                    next(null, session);
                } else {
                    this.VtigerConnector.Log.error("[vtiger-connector.createToken] too much attempts for this function");
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
        let data = JSON.stringify(buildDataFilter(where));
        this.getFreeSession((err, session) => {
            this.request(session, currentModel, getOperation(this, currentModel) + '.find', data, next);
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
            this.request(currentModel, getOperation(this, currentModel) + 'create', data, next);
        });
    }
}

/**
 *
 * @param filter
 * @returns {{}}
 */
function buildDataFilter(filter) {
    let returnFilter = {};
    const filterWhere = filter.where === undefined ? {} : filter.where;

    if (!filterWhere.and) {
        returnFilter = filterWhere;
    } else {
        filterWhere.and.forEach(function (itemFilter) {
            returnFilter = Assign(returnFilter, itemFilter);
        });
    }
    return returnFilter;
}

function getOperation(connector, model) {
    return connector.dataSource.modelBuilder.models[model].definition.settings.vtiOperation;
}

function cryptAccessKey(token, password) {
    return Crypto.createHash('md5').update(token + password).digest("hex");
}