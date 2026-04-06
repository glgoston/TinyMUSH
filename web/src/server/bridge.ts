import { IncomingMessage, Server } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import net from 'net';
import { SessionData } from 'express-session';
import { sessionMiddleware, socketMap } from './session';

/* Build an IAC NAWS sequence (Telnet Negotiate About Window Size, RFC 1073)
 * so the MUSH engine knows the terminal dimensions and wraps lines correctly. */
function nawsSequence(cols: number, rows: number): Buffer {
    return Buffer.from([
        0xff, 0xfa, 0x1f,                          /* IAC SB NAWS */
        (cols >> 8) & 0xff, cols & 0xff,
        (rows >> 8) & 0xff, rows & 0xff,
        0xff, 0xf0,                                /* IAC SE */
    ]);
}

/* The browser sends resize events as a special control message:
 *   Byte 0  = 0x01 (SOH sentinel)
 *   Bytes 1+ = JSON: {"cols": <n>, "rows": <n>}
 */
function parseResizeMessage(data: Buffer): { cols: number; rows: number } | null {
    if (data.length < 2 || data[0] !== 0x01) return null;
    try {
        const payload = JSON.parse(data.slice(1).toString('utf8')) as { cols?: number; rows?: number };
        if (typeof payload.cols === 'number' && typeof payload.rows === 'number') {
            return { cols: payload.cols, rows: payload.rows };
        }
    } catch {
        /* Malformed control message — ignore */
    }
    return null;
}

/* Run the express-session middleware on a raw IncomingMessage (WebSocket
 * upgrade request) so we get req.session populated without re-parsing cookies
 * manually.  The mock response satisfies the express middleware contract. */
function runSessionMiddleware(req: IncomingMessage): Promise<SessionData & { id: string }> {
    return new Promise((resolve, reject) => {
        const mockRes = {
            getHeader: () => undefined,
            setHeader: () => undefined,
            end: () => undefined,
        };
        sessionMiddleware(req as any, mockRes as any, (err?: unknown) => {
            if (err) {
                reject(err as Error);
                return;
            }
            const s = (req as any).session as SessionData & { id: string };
            resolve(s);
        });
    });
}

export function attachWebSocketServer(httpServer: Server): void {
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        runSessionMiddleware(req)
            .then((sess) => {
                if (!sess?.authenticated) {
                    ws.close(4001, 'Not authenticated');
                    return;
                }

                const sid = sess.id;
                const tcp = socketMap.get(sid);

                if (!tcp || tcp.destroyed) {
                    ws.close(4002, 'No game connection — please log in again');
                    return;
                }

                /* ── Heartbeat ── */
                let alive = true;
                const pingInterval = setInterval(() => {
                    if (!alive) {
                        ws.terminate();
                        return;
                    }
                    alive = false;
                    ws.ping();
                }, 30_000);

                ws.on('pong', () => { alive = true; });

                /* ── MUSH → browser ── */
                const onTcpData = (chunk: Buffer): void => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(chunk);
                    }
                };
                tcp.on('data', onTcpData);

                /* ── browser → MUSH ── */
                ws.on('message', (raw: Buffer) => {
                    if (!tcp || tcp.destroyed) return;

                    const resize = parseResizeMessage(raw);
                    if (resize) {
                        tcp.write(nawsSequence(resize.cols, resize.rows));
                        return;
                    }

                    tcp.write(raw);
                });

                /* ── Teardown ── */
                ws.on('close', () => {
                    clearInterval(pingInterval);
                    tcp.removeListener('data', onTcpData);
                    /* Leave the TCP socket alive — the session may reconnect */
                });

                tcp.on('close', () => {
                    clearInterval(pingInterval);
                    ws.close(4003, 'Game connection closed');
                    socketMap.delete(sid);
                });

                tcp.on('error', () => {
                    clearInterval(pingInterval);
                    ws.close(4004, 'Game connection error');
                    socketMap.delete(sid);
                });
            })
            .catch(() => ws.close(4000, 'Internal error'));
    });
}
