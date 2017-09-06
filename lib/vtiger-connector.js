'use strict';

let HttpClient = require('./http');
let SessionToken = require('./session-token');
let CacheSession = require('./cache-session');
let crypto = require('crypto');
let async = require('async');
let assign = require('object.assign');

const Connector = require('loopback-connector').Connector;

const logger = require(__dir_class + 'logger-winston');

let sessionsLoaded = false;
let INIT_SESSION = true;

/**
 *
 * @param dataSource
 * @param callback
 */
exports.initialize = function initializeDataSource(dataSource, callback) {
    dataSource.connector =  new VtigerConnector(dataSource.settings);
    dataSource.connector.dataSource = dataSource;

    if (callback) {
        dataSource.connector.connect(callback);
    }
};

function defineFunctions() {
    var spec = require('./rest-crud.json');

    var functions = {};
    spec.operations.forEach(function(op) {
        if (!op.template) {
            throw new Error(g.f('The operation template is missing: %j', op));
        }
        var builder = RequestBuilder.compile(op.template, requestFunc);
        builder.debug(spec.debug);

        // Bind all the functions to the template
        var functions = op.functions;
        if (functions) {
            for (var f in functions) {
                if (spec.debug) {
                    g.log('Mixing in method: %s %s', f, functions[f]);
                }
                var fn = builder.operation(functions[f]);
                functions[f] = fn;
            }
        }
    });
    return functions;
}

class VtigerConnector extends Connector {

    constructor(settings) {
        super();
        this.settings = settings || {};
        this.INIT_SESSION_COUNT = settings.countSessionsToInit !== undefined ? settings.countSessionsToInit : 10;
        this.MAX_ATTEMPT_SESSION = 30;
        this.TIME_OUT_BEFORE_NEW_LOGIN_ATTEMPT = 500;
        this.CACHED_VTI_SESSION_NAME = 'vtiSessionName';

        this.http = new HttpClient(settings);
        this.cache = new CacheSession();
        this.sessionToken = new SessionToken(settings);
        this.token = null;

    }

    /**
     *
     * @param next
     */
    connect(next) {
        this.sessionToken.getToken((err, token) => {
            if (err) {
                next(err, null);
            } else {
                this.token = token;
                if (INIT_SESSION) {
                    this.cache.flushUsedSessions(() => {
                        this.cache.countAvailableSessions((err, result) => {
                            INIT_SESSION = false;
                            if (err !== null) {
                                // TODO: gestion des erreurs
                                next(err, null);
                            } else {
                                if (result > this.INIT_SESSION_COUNT) {
                                    sessionsLoaded = true;
                                    next(null, result);
                                } else {
                                    this.bulkLogin(this.INIT_SESSION_COUNT, next);
                                }
                            }
                        });
                    });
                } else {
                    this.login(next);
                }
            }
        });
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
        this.http.request(options, (error, result) => {
            try {
                const resultJSON = JSON.parse(result);
                if (error === null && resultJSON.success && resultJSON.result && resultJSON.result.sessionName) {
                    this.vtiSessionName = resultJSON.result.sessionName;
                    logger.info("[vtiger-connector.login] Vti session name is " + this.vtiSessionName);
                    this.cache.addSession(this.vtiSessionName, (err, result) => {
                        if (err !== null) {
                            throw new Error(err);
                        } else {
                            next(null, this.vtiSessionName); // TODO check where next is calling to catch error
                        }
                    });
                } else {
                    this.sessionToken.invalidateToken();
                    this.connect(next);
                }
            } catch (e) {
                logger.error('[vtiger-connector.login] Error XHR request : ' + error);
                logger.error('[vtiger-connector.login] Error message : ' + e.message);
                next('Error login ' + error, null);
            }
        });
    }

    bulkLogin(count, next) {
        INIT_SESSION = false;
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

    request(currentModel, operation, data, next) {
        this.getFreeSession(0, (err, session) => {
            let errorLabel = `[${currentModel}][vtiger-connector.request]`;
            if (err === null) {
                let options = {
                    path: 'webservice.php',
                    form: {
                        operation: operation,
                        data: data,
                        sessionName: session
                    }
                };
                this.http.request(options, (error, result) => {
                    try {
                        this.cache.freeSession(session, (err) => {
                            if (err !== null) {
                                throw new Error(err);
                            } else {
                                if (!VtigerConnector.IsJsonString(result)) {
                                    next(`[${currentModel}][vtiger-connector.request] error : Bad JSON returned by VTIGER`);
                                } else {
                                    const resultJSON = JSON.parse(result);
                                    if (error === null && resultJSON.success && resultJSON.result) {
                                        next(null, resultJSON);
                                    } else if (!resultJSON.success && resultJSON.error.code !== undefined) {
                                        logger.error(' XHR request error : ' + resultJSON.error.code);
                                        if (resultJSON.error.code === 'INVALID_SESSIONID') {
                                            this.cache.removeSession(session);

                                            this.request(currentModel, operation, data, next);
                                        } else if (resultJSON.error.code === 'INTERNAL_SERVER_ERROR') {
                                            next(`${errorLabel} error : INTERNAL_SERVER_ERROR (from vtiger)`, null);
                                        }
                                    } else {
                                        throw new Error(`${errorLabel} error : ${error}`);
                                    }
                                }
                            }
                        });
                    } catch (e) {
                        logger.error(`${errorLabel} XHR request error : ${error}`);
                        logger.error(`${errorLabel} request error message: ${e.message}`);
                        next(e, null);
                    }
                });
            } else {
                next(err, null);
            }
        });
    }

    getFreeSession(atempts, next) {

        if (!sessionsLoaded) {
            if (attempts === this.MAX_ATTEMPT_SESSION) {
                logger.error("[vtiger-connector.getFreeSession] too much attempts for this function");
                logger.error("[vtiger-connector.getFreeSession] " + err);
                logger.error("[vtiger-connector.getFreeSession] " + session);
                next('Error authenticate', null);
            } else {
                setTimeout(() => {
                        this.getFreeSession(atempts++, next);
                    },
                    this.TIME_OUT_BEFORE_NEW_LOGIN_ATTEMPT);
            }
        } else {

            this.cache.getAvailableSession((err, session) => {

                if (session !== null && session !== undefined && session !== 'undefined') {
                    next(null, session);
                } else {

                    this.login(() => {
                    });
                    this.connect((err, result) => {
                        this.getFreeSession(0, next);
                    });
                }
            });
        }
    }

    /**
     *
     * @param currentModel
     * @param where
     * @param next
     */
    find(currentModel, where, next) {
        // console.log('find');
        let data = JSON.stringify(VtigerConnector.buildDataFilter(where));
        this.request(currentModel, VtigerConnector.getOperation(this, currentModel) + '.find', data, next);
    }

    /**
     *
     * @param currentModel
     * @param where
     * @param next
     */
    all(currentModel, where, next) {
        //console.log('all');
        let data = JSON.stringify(VtigerConnector.buildDataFilter(where));
        this.request(currentModel, VtigerConnector.getOperation(this, currentModel) + '.find', data, next);
    }

    /**
     *
     * @param currentModel
     * @param data
     * @param params
     * @param next
     */
    create(currentModel, data, params, next) {
        //console.log('create');
        data = JSON.stringify(data);
        this.request(currentModel, VtigerConnector.getOperation(this, currentModel) + '.create', data, next);
    }

    /**
     *
     * @param currentModel
     * @param data
     * @param params
     * @param next
     */
    updateOrCreate (currentModel, data, params, next) {
        //console.log('updateOrCreate');
        data = JSON.stringify(data);
        this.request(currentModel, VtigerConnector.getOperation(this, currentModel) + '.create', data, next);
    }

    /**
     *
     * @param currentModel
     * @param data
     * @param params
     * @param next
     */
    replaceOrCreate (currentModel, data, params, next) {
        //console.log('replaceOrCreate');
        data = JSON.stringify(data);
        this.request(currentModel, VtigerConnector.getOperation(this, currentModel) + '.create', data, next);
    }

    /**
     *
     * @param currentModel
     * @param data
     * @param params
     * @param next
     */
    findOrCreate (currentModel, data, params, next) {
        //console.log('findOrCreate');
        data = JSON.stringify(data);
        this.request(currentModel, VtigerConnector.getOperation(this, currentModel) + '.create', data, next);
    }

    /**
     *
     * @param currentModel
     * @param data
     * @param params
     * @param next
     */
    buildNearFilter(currentModel, data, params, next) {
        //console.log('buildNearFilter');
        data = JSON.stringify(data);
        this.request(currentModel, VtigerConnector.getOperation(this, currentModel) + '.create', data, next);
    }

    /**
     *
     * @param currentModel
     * @param data
     * @param params
     * @param next
     */
    destroyAll(currentModel, data, params, next) {
        //console.log('destroyAll');
        data = JSON.stringify(data);
        this.request(currentModel, VtigerConnector.getOperation(this, currentModel) + '.create', data, next);
    }

    /**
     *
     * @param currentModel
     * @param data
     * @param params
     * @param next
     */
    count(currentModel, data, params, next) {
        //console.log('count');
        data = JSON.stringify(data);
        this.request(currentModel, VtigerConnector.getOperation(this, currentModel) + '.create', data, next);
    }

    /**
     *
     * @param currentModel
     * @param data
     * @param params
     * @param next
     */
    save(currentModel, data, params, next) {
        //console.log('save');
        data = JSON.stringify(data);
        this.request(currentModel, VtigerConnector.getOperation(this, currentModel) + '.create', data, next);
    }

    /**
     *
     * @param currentModel
     * @param data
     * @param params
     * @param next
     */
    update(currentModel, data, params, next) {
        //console.log('update');
        data = JSON.stringify(data);
        this.request(currentModel, VtigerConnector.getOperation(this, currentModel) + '.create', data, next);
    }

    /**
     *
     * @param currentModel
     * @param data
     * @param params
     * @param next
     */
    count(currentModel, data, params, next) {
        //console.log('count');
        data = JSON.stringify(data);
        this.request(currentModel, VtigerConnector.getOperation(this, currentModel) + '.create', data, next);
    }

    /**
     *
     * @param currentModel
     * @param data
     * @param params
     * @param next
     */
    destroy(currentModel, data, params, next) {
        //console.log('destroy');
        data = JSON.stringify(data);
        this.request(currentModel, VtigerConnector.getOperation(this, currentModel) + '.create', data, next);
    }

    /**
     *
     * @param currentModel
     * @param data
     * @param params
     * @param next
     */
    replaceById (currentModel, data, params, next) {
        //console.log('replaceById');
        data = JSON.stringify(data);
        this.request(currentModel, VtigerConnector.getOperation(this, currentModel) + '.create', data, next);
    }

    /**
     *
     * @param currentModel
     * @param data
     * @param params
     * @param next
     */
    updateAttributes (currentModel, data, params, next) {
        //console.log('updateAttributes');
        data = JSON.stringify(data);
        this.request(currentModel, VtigerConnector.getOperation(this, currentModel) + '.create', data, next);
    }

    static buildDataFilter(filter) {
        let returnFilter = {};
        const filterWhere = filter.where === undefined ? {} : filter.where;

        if (!filterWhere.and) {
            returnFilter = filterWhere;
        } else {
            filterWhere.and.forEach(function(itemFilter) {
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

    static IsJsonString(str) {
        try {
            JSON.parse(str);
        } catch (e) {
            return false;
        }
        return true;
    }
}
