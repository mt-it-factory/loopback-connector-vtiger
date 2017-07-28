'use strict';

let freeSessions = [];
let usedSessions = [];

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
            usedSessions = CacheSession.unsetSession(usedSessions, session);
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
        sessions = CacheSession.unsetSession(sessions, session);
        this.setSessions(sessions);
    }

    /**
     * Unset session from sessions
     * @param array
     * @param value
     * @returns {*}
     */
    static unsetSession(array, value) {
        var index = array.indexOf(value);
        if (index >= 0) {
            array.splice( index, 1 );
        }
        return array;
    }
}

module.exports = CacheSession;