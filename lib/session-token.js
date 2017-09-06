'use strict';

let TOKEN = null;
let alreadyAskedToken = false;

let async = require('async');

const LoggerWinston = require(__dir_class + 'logger-winston');
const logger = new LoggerWinston();

class SessionToken {
    /**
     *
     * @param VtigerConnector
     * @param settings
     */
    constructor(VtigerConnector, settings) {
        this.http = VtigerConnector.http;

        this.settings = settings;
        this.expiryDate = new Date();
        this.token = '';

        this.MAX_ATTEMPT_TOKEN = 10;
        this.TIME_OUT_BEFORE_NEW_LOGIN_ATTEMPT = 1000;
        this.TOKEN_KEY = 'vtigerToken';

        this.vtigerConnector = VtigerConnector;
    }

    createToken(next) {
        if (this.isValid()) {
            logger.info("[vtiger-connector.createToken] Token exists : " + this.VtigerSessionToken.getToken().token);
            this.connect(next);
            return;
        }
        logger.info("[vtiger-connector.createToken] Try to create new token into VTI");
        let times = 0;
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
                    this.requestToken(next);
                } else {
                    logger.error("[vtiger-connector.createToken] too much attempts for this function");
                    next('Error authenticate', null);
                }
            }
        )
    }

    requestToken(next) {
        alreadyAskedToken = true;
        let options = {
            path: 'webservice.php?operation=getchallenge&username=' + this.settings.username
        };

        this.http.request(options, (error, response, body) => {
            alreadyAskedToken = false;
            const resultJSON = JSON.parse(body);
            if (error === null &&
                resultJSON.success &&
                resultJSON.result.token &&
                resultJSON.result.expireTime &&
                resultJSON.result.serverTime
            ) {
                this.setResult(resultJSON.result);
                logger.info("[vtiger-connector.requestToken] Token is " + this.getToken().token);
                this.vtigerConnector.connect(next);
            } else {
                if (!error) {
                    logger.error("[vtiger-connector.requestToken] Error token not found into response : " + resultJSON);
                } else {
                    logger.error("[vtiger-connector.requestToken] Error : " + error);
                }
                next('Error token not found', null);
            }
        });
    }

    /** @namespace result.token */
    /** @namespace result.expireTime */
    /** @namespace result.serverTime */
    setResult(result) {
        this.token = result.token;
        let lifeTime = (result.expireTime - result.serverTime);
        let myCurrentDate = new Date();
        this.expiryDate.setTime(myCurrentDate.getTime() + lifeTime * 1000);
        let token = {
            token: result.token,
            expiryDate: this.expiryDate
        }
        // this.cache.put(this.TOKEN_KEY, token);
        TOKEN = token;
    }

    isValid() {
        let isValid = this.hasToken() && !this.isExpired();
        if (!isValid) {
            this.invalidateToken();
        }
        return isValid;
    }

    /**
     *
     * @return {string}
     */
    getToken() {
        return TOKEN;
        // return this.cache.get(this.TOKEN_KEY);
    }

    /**
     * token is already set
     * @return {boolean}
     */
    hasToken() {
        return this.getToken() !== null;
    }

    /**
     * Token is expired,
     * @return {boolean}
     */
    isExpired() {
        let token = this.getToken();
        let currentDate = new Date();
        let isExpired = (token.expiryDate < currentDate);
        if (isExpired) {
            logger.info('Token is expired ' + token.expiryDate.toISOString() + ' < ' + currentDate.toISOString());
        } else {
            logger.info('Token is valid ' + token.expiryDate.toISOString() + ' > ' + currentDate.toISOString());
        }
        return isExpired
    }

    invalidateToken() {
        // this.cache.del(this.TOKEN_KEY);
        TOKEN = null;
    }
}

module.exports = SessionToken;