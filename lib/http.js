'use strict';

const req = require('request');
const VERSION = require('../package.json').version;

class HttpClient {
    constructor(settings) {
        this.settings = settings;
        this.req = req;
    }

    /**
     *
     * @param settings
     * @param next
     */
    request(settings, next) {
        settings = Object.assign({}, this.settings, settings);
        this.req(buildRequest(settings), function (error, res, body) {
            if (error) {
                next(error);
            } else {
                next(null, res, body);
            }
        });
    }
}

/**
 *
 * @param settings
 * @returns {*}
 */
function buildRequest(settings) {
    settings.method = settings.form ? 'POST' : 'GET';

    settings.uri = `${settings.host}/${settings.path}`;

    settings.headers = {
        'User-Agent': 'loopback-connector-vtiger/' + VERSION,
        "Accepts": 'application/json',
        "Content-type": 'application/json'
    };
    return settings;
}

module.exports = HttpClient;