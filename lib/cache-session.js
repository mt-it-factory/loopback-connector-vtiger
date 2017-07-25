'use strict';

let freeSessions = [];
let usedSessions = [];

/**
 * Remove elem from array by value
 *
 let ary = ['three', 'seven', 'eleven'];
 ary.remove('seven');
 returned value: (Array) ['three', 'eleven']

 * @returns {Array}
 */
Array.prototype.remove = function() {
    let what,
        a = arguments,
        L = a.length,
        ax;
    while (L && this.length) {
        what = a[--L];
        while ((ax = this.indexOf(what)) !== -1) {
            this.splice(ax, 1);
        }
    }
    return this;
};

class CacheSession {
    constructor(settings) {

    }

    /**
     *
     * @param sessionName
     */
    addSession(sessionName) {
        let sessions = this.getSessions();
        if (sessions === null) {
            sessions = [sessionName];
        } else {
            sessions.push(sessionName);
        }
        this.setSessions(sessions, true);
    }

    /**
     *
     * @param free
     */
    getSessions(free = true) {
        let sessions = (free) ? freeSessions : usedSessions;
        return sessions;
    }

    /**
     *
     * @param free
     * @returns {Array}
     */
    setSessions(sessions, free = true) {
        if(free) {
            freeSessions = sessions;
        } else {
            usedSessions = sessions;
        }
    }

    /**
     *
     * @param next
     */
    getAvailableSession(next) {
        let sessions = this.getSessions();
        let toUse = null;
        if (sessions !== null && sessions.length > 0) {
            toUse = sessions.pop();
            this.setSessions(sessions);
        }
        next(toUse);
    }

    /**
     *
     * @param session
     */
    freeSession(session) {
        let usedSessions = this.getSessions(false);
        let freeSessions = this.getSessions();
        if (usedSessions !== null) {
            usedSessions = usedSessions.remove(session);
            this.setSessions(usedSessions, false);
        }
        this.addSession(session);
    }

    /**
     *
     * @param session
     */
    removeSession(session) {
        let sessions = this.getSessions();
        usedSessions = sessions.remove(session);
        this.setSessions(usedSessions);
    }
}

module.exports = CacheSession;