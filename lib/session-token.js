'use strict';
const app = require(__dir_server + 'server.js');

let async = require('async');
const redis = require('redis');
const redisConfig = app.get('redis');
const HttpClient = require('./http');
const logger = require(__dir_class + 'logger-winston');

let TOKEN = null;
let CACHE_SESSION_TOKEN_KEY = 'session:token';
let alreadyAskedToken = false;

let cache = redis.createClient(redisConfig);

class SessionToken {
    /**
     *
     * @param VtigerConnector
     * @param settings
     */
    constructor(settings) {
        this.http = new HttpClient(settings);

        this.settings = settings;

        this.MAX_ATTEMPT_TOKEN = 10;
        this.TIME_OUT_BEFORE_NEW_LOGIN_ATTEMPT = 1000;
    }

    _createToken(next) {
        logger.info("[vtiger-connector.createToken] Try to create new token into VTI");
        async.retry({
                times: this.MAX_ATTEMPT_TOKEN,
                interval: this.TIME_OUT_BEFORE_NEW_LOGIN_ATTEMPT
            },
            (callback) => {
                if (alreadyAskedToken) {
                    callback('already asked');
                } else {
                    callback(null, 'ask token');
                }
            },
            (err, result) => {
                if (err === null) {
                    this._requestToken(next);
                } else {
                    let msg = 'too much attempts for requestToken';
                    logger.error("[vtiger-connector.createToken] " + msg);
                    next('Error createToken: ' + msg, null);
                }
            }
        )
    }

    _requestToken(next) {
        alreadyAskedToken = true;
        let options = {
            path: 'webservice.php?operation=getchallenge&username=' + this.settings.username
        };

        this.http.request(options, (err, response) => {
            alreadyAskedToken = false;
            const resultJSON = JSON.parse(response);
            if (err === null &&
                resultJSON.success &&
                resultJSON.result.token &&
                resultJSON.result.expireTime &&
                resultJSON.result.serverTime
            ) {
                this._setToken(resultJSON.result);
                let token = resultJSON.result.token;
                logger.info("[vtiger-connector.requestToken] Token is " + token);
                next(err, token);
            } else {
                if (!err) {
                    logger.error("[vtiger-connector.requestToken] Error token not found into response : " + resultJSON);
                } else {
                    logger.error("[vtiger-connector.requestToken] Error : " + err);
                }
                next('Error token not found', null);
            }
        });
    }

    /** @namespace result.token */
    /** @namespace result.expireTime */
    /** @namespace result.serverTime */
    _setToken(result) {
        let lifeTime = (result.expireTime - result.serverTime);
        cache.set(CACHE_SESSION_TOKEN_KEY, result.token, (err, result) => {
            cache.expire(CACHE_SESSION_TOKEN_KEY, lifeTime);
        });
    }

    /**
     *
     * @return {string}
     */
    getToken(next) {
        cache.get(CACHE_SESSION_TOKEN_KEY, (err, token) => {
            if (token === null) {
                this._createToken(next)
            } else {
                logger.info("[vtiger-connector.createToken] Token exists : " + token);
                next(err, token);
            }
        });
    }

    invalidateToken() {
        cache.del(CACHE_SESSION_TOKEN_KEY);
    }
}

module.exports = SessionToken;