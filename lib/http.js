'use strict';

const VERSION = require('../package.json').version;
let req = require('request-promise');

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
        req(buildRequest(settings)).then((result) => {
            next(null, result);
        }).catch((err) => {
            next(err, null);
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