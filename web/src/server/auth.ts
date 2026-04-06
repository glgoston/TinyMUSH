import { Router, Request, Response } from 'express';
import net from 'net';
import rateLimit from 'express-rate-limit';
import { socketMap } from './session';

const MUSH_HOST = process.env.MUSH_HOST ?? 'localhost';
const MUSH_PORT = parseInt(process.env.MUSH_PORT ?? '6250', 10);

/* 5 login attempts per minute per IP — prevents brute-force attacks */
const loginLimiter = rateLimit({
    windowMs: 60 * 1_000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Please try again in a minute.' },
});

/* Strip control characters and limit length to prevent injection into the
 * MUSH connect command.  MUSH credentials must not contain CR / LF / NUL. */
function sanitize(s: string): string {
    return s.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 128);
}

export function createAuthRouter(): Router {
    const router = Router();

    router.post('/login', loginLimiter, (req: Request, res: Response) => {
        const body = req.body as { username?: string; password?: string };
        const username = sanitize(body.username ?? '');
        const password = sanitize(body.password ?? '');

        if (!username || !password) {
            res.status(400).json({ error: 'Username and password are required.' });
            return;
        }

        const tcp = net.createConnection({ host: MUSH_HOST, port: MUSH_PORT });
        let responded = false;
        let buffer = '';

        tcp.setTimeout(10_000);

        tcp.once('connect', () => {
            /* Wait for the initial banner, then send the connect command */
            tcp.once('data', () => {
                tcp.write(`connect ${username} ${password}\r\n`);
            });
        });

        /* After sending credentials, collect the engine's response.
         * If an error pattern appears, fail immediately.
         * If no error within 3 seconds, assume success (MUSH doesn't always
         * send a dedicated "connected" confirmation before the MOTD). */
        tcp.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf8');

            const failed = /GAME:\s*(Incorrect|No such|Bad\s+login|FAILED)|Bad name|Bad password/i.test(buffer);
            if (failed && !responded) {
                responded = true;
                tcp.destroy();
                res.status(401).json({ error: 'Authentication failed.' });
            }
        });

        const successTimeout = setTimeout(() => {
            if (!responded) {
                responded = true;
                /* Stash the open socket for the subsequent WebSocket upgrade */
                socketMap.set(req.sessionID, tcp);
                req.session.username = username;
                req.session.authenticated = true;
                req.session.save((err) => {
                    if (err) {
                        tcp.destroy();
                        socketMap.delete(req.sessionID);
                        res.status(500).json({ error: 'Session error.' });
                        return;
                    }
                    res.json({ ok: true, username });
                });
            }
        }, 3_000);

        tcp.on('timeout', () => {
            clearTimeout(successTimeout);
            if (!responded) {
                responded = true;
                tcp.destroy();
                res.status(504).json({ error: 'Connection to game server timed out.' });
            }
        });

        tcp.on('error', () => {
            clearTimeout(successTimeout);
            if (!responded) {
                responded = true;
                res.status(502).json({ error: 'Cannot connect to game server.' });
            }
        });

        tcp.on('close', () => clearTimeout(successTimeout));
    });

    router.post('/logout', (req: Request, res: Response) => {
        const tcp = socketMap.get(req.sessionID);
        if (tcp && !tcp.destroyed) {
            tcp.write('QUIT\r\n');
            tcp.destroy();
        }
        socketMap.delete(req.sessionID);
        req.session.destroy(() => {
            res.json({ ok: true });
        });
    });

    return router;
}
