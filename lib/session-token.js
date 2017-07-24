'use strict';

const async = require('async');

let TOKEN = null;

class SessionToken {
    /**
     *
     * @param VtigerConnector
     * @param settings
     */
    constructor(VtigerConnector, settings) {
        this.expiryDate = new Date();
        this.token = '';
        this.alreadyAskedToken = false;
        this.MAX_ATTEMPT_TOKEN = 10;
        this.TIME_OUT_BEFORE_NEW_LOGIN_ATTEMPT = 500;
        this.TOKEN_KEY = 'vtigerToken';
        this.VtigerConnector = VtigerConnector;
    }

    createToken(next) {
        if (this.isValid()) {
            this.VtigerConnector.Log.info("[vtiger-connector.createToken] Token exists : " + this.VtigerSessionToken.getToken().token);
            this.VtigerConnector.connect(next);
            return;
        }
        this.VtigerConnector.Log.info("[vtiger-connector] Try to create new token into VTI");
        async.retry({
                errorFilter: function (err) {
                    return err.message === 'Temporary error'; // only retry on a specific error
                },
                times: this.MAX_ATTEMPT_TOKEN,
                interval: this.TIME_OUT_BEFORE_NEW_LOGIN_ATTEMPT
            },
            (next) => {
                return next(this.alreadyAskedToken);
            },
            (err) => {
                if (!err) {
                    this.requestToken(next);
                } else {
                    this.VtigerConnector.Log.error("[vtiger-connector.createToken] too much attempts for this function");
                    next('Error authenticate', null);
                }
            }
        )
    }

    requestToken(next) {
        let options = {
            path: 'webservice.php?operation=getchallenge&username=' + this.VtigerConnector.settings.username
        };

        this.VtigerConnector.Http.request(options, (error, response, body) => {
            this.alreadyAskedToken = false;
            const resultJSON = JSON.parse(body);
            if (error === null &&
                resultJSON.success &&
                resultJSON.result.token &&
                resultJSON.result.expireTime &&
                resultJSON.result.serverTime
            ) {
                this.setResult(resultJSON.result);
                this.VtigerConnector.Log.info("[vtiger-connector.createToken] Token is " + this.getToken().token);
                this.VtigerConnector.connect(next);
            } else {
                if (!error) {
                    this.VtigerConnector.Log.error("[vtiger-connector.createToken] Error token not found into response : " + resultJSON);
                } else {
                    this.VtigerConnector.Log.error("[vtiger-connector.createToken] Error : " + error);
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
            this.VtigerConnector.Log.info('Token is expired ' + token.expiryDate.toISOString() + ' < ' + currentDate.toISOString());
        } else {
            this.VtigerConnector.Log.info('Token is valid ' + token.expiryDate.toISOString() + ' > ' + currentDate.toISOString());
        }
        return isExpired
    }

    invalidateToken() {
        // this.cache.del(this.TOKEN_KEY);
        TOKEN = null;
    }
}

module.exports = SessionToken;