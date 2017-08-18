'use strict';
const app = require(__dir_server + 'server.js');

const redis = require('redis');
const redisConfig = app.get('redis');
let cache = redis.createClient(redisConfig);

const LoggerWinston = require(__dir_class + 'logger-winston');
const logger = new LoggerWinston();

const CACHE_SESSION_AVAILABLE_KEY = 'sessions:available';
const CACHE_SESSION_USED_KEY = 'sessions:used';

class CacheSession {
    constructor() {
    }

    /**
     *
     * @param sessionName
     */
    addSession(sessionName, next) {
        if (sessionName === null || sessionName === undefined && typeof next === 'function') {
            next('Session is null', null);
        } else {
            cache.lpush(CACHE_SESSION_AVAILABLE_KEY, sessionName, (err, countAvailable) => {
                if (err !== null) {
                    logger.error('[cache-session.addSession] Error on rpush: ' + err);
                }
                if (typeof next === 'function') {
                    next(err, null);
                }
            });
        }
    }

    /**
     *
     * @param next
     */
    getAvailableSession(next) {
        this.countAvailableSessions((err, count) => {
            if (count > 0) {
                cache.brpoplpush(CACHE_SESSION_AVAILABLE_KEY, CACHE_SESSION_USED_KEY, 5, (err, result) => {
                    if (err !== null || result === null || result === undefined || result === 'undefined') {
                        logger.info('[cache-session.getAvailableSession] Error on brpoplpush: ' + err);
                        next('No session available', null);
                    } else {
                        next(err, result);
                    }
                });
            } else {
                next('No session available', null);
            }
        });
    }

    /**
     *
     * @param next
     */
    countAvailableSessions(next) {
        cache.llen(CACHE_SESSION_AVAILABLE_KEY, (err, result) => {
            next(err, result);
        });
    }

    /**
     *
     * @param next
     */
    flushUsedSessions(next) {
        cache.llen(CACHE_SESSION_USED_KEY, (err, result) => {
            if (result === 0) {
                next();
            } else {
                cache.lrange(CACHE_SESSION_USED_KEY, 0, result, (err, result) => {
                    this.addSession(result);
                    cache.del(CACHE_SESSION_USED_KEY);
                    next();
                });
            }
        });
    }

    /**
     *
     * @param session
     */
    freeSession(session, next) {
        if (session !== null && session !== undefined) {
            cache.lrem(CACHE_SESSION_USED_KEY, 0, session);
            this.addSession(session, (err, result) => {
                next(err, null);
            });
        } else {
            next('No session to free', null);
        }
    }

    /**
     *
     * @param session
     */
    removeSession(session) {
        cache.lrem(CACHE_SESSION_USED_KEY, 0, session);
    }
}

module.exports = CacheSession;