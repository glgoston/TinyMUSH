import Split from 'split.js';
import { Terminal } from '@xterm/xterm';
import { createTerminal } from './terminal';
import {
    feedWhoData,
    feedRoomData,
    renderWhoPanel,
    renderRoomPanel,
    PlayerEntry,
    RoomInfo,
} from './panels';
import {
    initConstruction,
    checkCapability,
    onTerminalLine  as constructionOnLine,
    onRoomUpdate    as constructionOnRoom,
    onCommandSent   as constructionOnCmd,
} from './construction/index';

/* ── DOM elements ── */
const loginOverlay  = document.getElementById('login-overlay')!;
const loginUser     = document.getElementById('login-user')   as HTMLInputElement;
const loginPass     = document.getElementById('login-pass')   as HTMLInputElement;
const loginBtn      = document.getElementById('login-btn')    as HTMLButtonElement;
const loginError    = document.getElementById('login-error')!;
const app           = document.getElementById('app')!;
const topbarUser    = document.getElementById('topbar-user')!;
const logoutBtn     = document.getElementById('logout-btn')   as HTMLButtonElement;
const buildBtn      = document.getElementById('build-btn')    as HTMLButtonElement;
const statusDot     = document.getElementById('status-dot')!;
const termWrapper   = document.getElementById('terminal-wrapper')!;
const whoPanel      = document.getElementById('who-panel')!;
const roomPanel     = document.getElementById('room-panel')!;
const playPanels    = document.getElementById('play-panels')!;
const buildPanels   = document.getElementById('build-panels')!;
const cmdInput      = document.getElementById('cmd-input')    as HTMLInputElement;
const sendBtn       = document.getElementById('send-btn')     as HTMLButtonElement;

/* ── State ── */
let term: Terminal | null = null;
let ws: WebSocket | null = null;
const history: string[] = [];
let historyIdx = -1;

/* ── Split pane ── */
function initSplit(): void {
    Split(['#terminal-pane', '#side-pane'], {
        sizes: [70, 30],
        minSize: [300, 180],
        gutterSize: 4,
        direction: 'horizontal',
        onDrag: () => {
            /* terminal resize is handled by the ResizeObserver in terminal.ts */
        },
    });
}

/* ── Build a resize control message for the server (see bridge.ts) ── */
function makeResizeMsg(cols: number, rows: number): Uint8Array {
    const json = JSON.stringify({ cols, rows });
    const buf = new Uint8Array(1 + json.length);
    buf[0] = 0x01; /* SOH sentinel */
    for (let i = 0; i < json.length; i++) buf[i + 1] = json.charCodeAt(i);
    return buf;
}

/* ── WebSocket / game connection ── */
function connectWS(username: string): void {
    /* Use wss: in production (behind Caddy TLS), ws: in dev */
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
        setStatus('connected');
        cmdInput.disabled = false;
        sendBtn.disabled  = false;
        cmdInput.focus();

        /* Tell the server the initial terminal size */
        if (term) {
            ws!.send(makeResizeMsg(term.cols, term.rows));
        }

        /* Probe whether the character has builder/wizard privileges */
        checkCapability(sendCommand);
    };

    ws.onclose = (ev) => {
        setStatus('disconnected');
        cmdInput.disabled = true;
        sendBtn.disabled  = true;
        if (term) {
            term.writeln('\r\n\x1b[31m[Connection closed]\x1b[0m');
        }
        console.info('WebSocket closed', ev.code, ev.reason);
    };

    ws.onerror = () => {
        if (term) term.writeln('\r\n\x1b[31m[Connection error]\x1b[0m');
    };

    ws.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
        const bytes = new Uint8Array(ev.data);
        const text = new TextDecoder('utf-8').decode(bytes);

        /* Write raw bytes to xterm.js (preserves ANSI sequences and box-drawing) */
        if (term) term.write(bytes);

        /* Feed side-panel parsers */
        feedWhoData(text, (players: PlayerEntry[]) => renderWhoPanel(whoPanel, players));
        feedRoomData(text, (info: RoomInfo) => {
            renderRoomPanel(roomPanel, info);
            constructionOnRoom(info);
        });

        /* Fan each line to the construction module for capability detection
         * and room-creation confirmations */
        text.split('\n').forEach((line) => constructionOnLine(line));
    };
}

function setStatus(s: 'connected' | 'disconnected' | 'idle'): void {
    statusDot.className = s;
}

/* ── Send a command ── */
function sendCommand(cmd: string): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const line = cmd.endsWith('\r\n') ? cmd : cmd + '\r\n';
    ws.send(new TextEncoder().encode(line));
    constructionOnCmd(cmd);
}

/* ── Input bar ── */
function setupInputBar(): void {
    const doSend = (): void => {
        const cmd = cmdInput.value;
        if (!cmd) return;
        sendCommand(cmd);
        /* Echo locally so the player sees what they typed */
        if (term) term.writeln('\r\x1b[36m' + cmd + '\x1b[0m');
        if (history[0] !== cmd) history.unshift(cmd);
        if (history.length > 200) history.pop();
        historyIdx = -1;
        cmdInput.value = '';
    };

    cmdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            doSend();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (historyIdx < history.length - 1) {
                historyIdx++;
                cmdInput.value = history[historyIdx] ?? '';
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIdx > 0) {
                historyIdx--;
                cmdInput.value = history[historyIdx] ?? '';
            } else if (historyIdx === 0) {
                historyIdx = -1;
                cmdInput.value = '';
            }
        }
    });

    sendBtn.addEventListener('click', doSend);
}

/* ── Login flow ── */
async function doLogin(): Promise<void> {
    const username = loginUser.value.trim();
    const password = loginPass.value;

    if (!username || !password) {
        showLoginError('Please enter your character name and password.');
        return;
    }

    loginBtn.disabled = true;
    loginError.textContent = '';

    try {
        const resp = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ username, password }),
        });

        if (!resp.ok) {
            const body = await resp.json().catch(() => ({})) as { error?: string };
            showLoginError(body.error ?? 'Login failed.');
            return;
        }

        /* Show the app shell */
        loginOverlay.classList.add('hidden');
        app.classList.remove('hidden');
        topbarUser.textContent = username;

        /* Initialise layout and terminal */
        initSplit();
        term = createTerminal(termWrapper, (cols, rows) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(makeResizeMsg(cols, rows));
            }
        });

        setupInputBar();
        connectWS(username);

        /* Wire construction mode (hidden until capability confirmed) */
        console.log('[Init] Initializing construction mode');
        initConstruction(sendCommand, { buildBtn, playPanels, buildPanels });

    } finally {
        loginBtn.disabled = false;
    }
}

function showLoginError(msg: string): void {
    loginError.textContent = msg;
}

/* Kick off login on Enter in either field */
loginUser.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginPass.focus(); });
loginPass.addEventListener('keydown', (e) => { if (e.key === 'Enter') void doLogin(); });
loginBtn.addEventListener('click', () => void doLogin());

/* ── Logout ── */
logoutBtn.addEventListener('click', async () => {
    ws?.close();
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    app.classList.add('hidden');
    loginOverlay.classList.remove('hidden');
    loginPass.value = '';
    loginError.textContent = '';
    setStatus('idle');
});

/* ── Focus the username field on page load ── */
loginUser.focus();
