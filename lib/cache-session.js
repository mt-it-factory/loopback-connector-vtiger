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
    constructor(settings) {
    }

    /**
     *
     * @param sessionName
     */
    addSession(sessionName) {
        cache.lpush(CACHE_SESSION_AVAILABLE_KEY, sessionName, (err, result) => {
            if (err !== null) {
                logger.error('[cache-session.addSession] Error on rpush: ' + err);
            }
        });
    }

    /**
     *
     * @param sessions (array)
     */
    addSessions(sessions) {
        cache.rpush(CACHE_SESSION_AVAILABLE_KEY, sessions, (err, result) => {
            if (err !== null) {
                logger.error('[cache-session.addSessions] Error on rpush: ' + err);
            }
        });
    }

    /**
     *
     * @param next
     */
    getAvailableSession(next) {
        this.countAvailableSessions((err, count) => {
            if (count > 0) {
                cache.brpoplpush(CACHE_SESSION_AVAILABLE_KEY, CACHE_SESSION_USED_KEY, 5, (err, result) => {
                    if (err !== null || result === null || result === undefined) {
                        logger.info('[cache-session.addSessions] Error on brpoplpush: ' + err);
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

    countAvailableSessions(next) {
        cache.llen(CACHE_SESSION_AVAILABLE_KEY, (err, result) => {
            next(err, result);
        });
    }

    flushUsedSessions(next) {
        cache.llen(CACHE_SESSION_USED_KEY, (err, result) => {
            if (result === 0) {
                next();
            } else {
                cache.lrange(CACHE_SESSION_USED_KEY, 0, result, (err, result) => {
                    this.addSessions(result);
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
    freeSession(session) {
        if (session !== null) {
            cache.lrem(CACHE_SESSION_USED_KEY, 0, session);
            this.addSession(session);
        }
    }

    /**
     *
     * @param session
     */
    static removeSession(session) {
        cache.lrem(CACHE_SESSION_USED_KEY, 0, session);
    }
}

module.exports = CacheSession;