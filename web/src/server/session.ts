import { RequestHandler } from 'express';
import session, { SessionData, Store, MemoryStore } from 'express-session';
import net from 'net';

/* Extend the session type so TypeScript knows about our custom fields */
declare module 'express-session' {
    interface SessionData {
        username?: string;
        authenticated?: boolean;
    }
}

/* Map from session ID → live TCP socket to the MUSH engine.
 * The socket is opened during the login flow (auth.ts) and reused by the
 * WebSocket bridge (bridge.ts) for every subsequent message. */
export const socketMap = new Map<string, net.Socket>();

/* Exported so bridge.ts can run the middleware on WebSocket upgrade requests */
export let sessionMiddleware: RequestHandler;
export let sessionStore: Store;

export function initSession(): void {
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
        throw new Error('SESSION_SECRET environment variable is not set');
    }

    sessionStore = new MemoryStore();

    sessionMiddleware = session({
        secret,
        store: sessionStore,
        name: 'tinymush.sid',
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: 'strict',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000,   /* 24 hours */
        },
    });
}
