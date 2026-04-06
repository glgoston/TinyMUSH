import express, { Request, Response } from 'express';
import helmet from 'helmet';
import path from 'path';
import http from 'http';

import { initSession, sessionMiddleware, socketMap } from './session';
import { createAuthRouter } from './auth';
import { attachWebSocketServer } from './bridge';

/* ── Initialise session store (validates SESSION_SECRET) ── */
initSession();

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*';

/* In production the compiled server is at dist/server/server.js;
 * the Vite-built frontend lives at dist/public/. */
const CLIENT_DIR = path.join(__dirname, '../public');

const app = express();
const httpServer = http.createServer(app);

/* ── Security headers (helmet) ── */
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                fontSrc: ["'self'"],
                connectSrc: ["'self'", 'ws:', 'wss:'],
                imgSrc: ["'self'", 'data:'],
            },
        },
    }),
);

/* ── CORS — restrict in production, open in development ── */
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (ALLOWED_ORIGIN === '*' || origin === ALLOWED_ORIGIN) {
        res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    }
    if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
    }
    next();
});

app.use(express.json());
app.use(sessionMiddleware);

/* ── REST API ── */
app.use('/api', createAuthRouter());

/* ── Static SPA ── */
app.use(express.static(CLIENT_DIR));
app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(CLIENT_DIR, 'index.html'));
});

/* ── WebSocket server ── */
attachWebSocketServer(httpServer);

/* ── Graceful shutdown ── */
process.on('SIGTERM', () => {
    socketMap.forEach((tcp) => { if (!tcp.destroyed) tcp.destroy(); });
    socketMap.clear();
    httpServer.close(() => process.exit(0));
});

httpServer.listen(PORT, () => {
    console.log(`TinyMUSH web interface listening on :${PORT}`);
});
