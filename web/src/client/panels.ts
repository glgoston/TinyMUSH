/* Side-panel helpers — parsing WHO output and room names from raw MUSH text.
 *
 * Phase 4a approach: watch the raw terminal stream for recognisable output
 * patterns and extract structured data to display in the side panels.
 * This requires no changes to the game engine.
 *
 * Everything here is best-effort; if parsing fails the panels simply retain
 * their last known state.
 */

export interface PlayerEntry {
    name: string;
    idle: string;
    doing: string;
}

export interface RoomInfo {
    name: string;
    dbref?: string;   /* numeric string extracted from room-name line when available */
    exits: string[];
}

/* ── WHO panel ── */

/** Parse a line of MUSH WHO/DOING output.
 *  Common formats:
 *    "PlayerName   00:01  Playing the game"
 *    "PlayerName   01:23  Idle"
 */
function parseWhoLine(line: string): PlayerEntry | null {
    /* Strip ANSI escape sequences before parsing */
    const clean = line.replace(/\x1b\[[0-9;]*[mGKHFABCDJ]/g, '').trim();
    if (!clean || clean.startsWith('---') || clean.startsWith('===')) return null;

    /* Expect at least two whitespace-separated columns: name + idle-time */
    const parts = clean.split(/\s{2,}/);
    if (parts.length < 2) return null;

    /* Heuristic: idle column looks like HH:MM or a number */
    const [name, idle, ...rest] = parts;
    if (!/^\d{2}:\d{2}/.test(idle) && !/^\d+$/.test(idle)) return null;

    return { name, idle, doing: rest.join(' ') };
}

/* Accumulates partial WHO output across multiple data events */
let whoBuffer = '';
let inWhoBlock = false;

export function feedWhoData(
    raw: string,
    onUpdate: (players: PlayerEntry[]) => void,
): void {
    whoBuffer += raw;

    /* Detect start of WHO output */
    if (!inWhoBlock && /Player\s+On\s+Idle|Name\s+Conn\s+Idle/i.test(whoBuffer)) {
        inWhoBlock = true;
    }

    /* Detect end of WHO output (typically a separator line or the prompt) */
    if (inWhoBlock) {
        const endMatch = whoBuffer.match(/[-=]{10,}.*\n.*\d+ Players?/s);
        if (endMatch) {
            const block = whoBuffer.slice(0, whoBuffer.indexOf(endMatch[0]) + endMatch[0].length);
            const players = block
                .split('\n')
                .map(parseWhoLine)
                .filter((p): p is PlayerEntry => p !== null);
            if (players.length > 0) onUpdate(players);
            whoBuffer = whoBuffer.slice(whoBuffer.indexOf(endMatch[0]) + endMatch[0].length);
            inWhoBlock = false;
        }
    }

    /* Don't let the buffer grow unboundedly */
    if (whoBuffer.length > 4096) whoBuffer = whoBuffer.slice(-2048);
}

/* ── Room panel ── */

let roomBuffer = '';

export function feedRoomData(raw: string, onUpdate: (info: RoomInfo) => void): void {
    roomBuffer += raw;
    const lines = roomBuffer.split('\n');
    roomBuffer = lines.pop() ?? '';

    for (let i = 0; i < lines.length; i++) {
        const clean = lines[i].replace(/\x1b\[[0-9;]*[mGKHFABCDJ]/g, '').trim();

        /* Room name is typically on a line by itself (capitalised, no leading spaces).
         * It is usually followed by a description and then "Obvious exits:". */
        const exitMatch = clean.match(/^(?:Obvious exits|Exits):\s*(.*)$/i);
        if (exitMatch) {
            /* Look backward for the room name */
            let roomName = '';
            let roomDbref: string | undefined;
            for (let j = i - 1; j >= 0 && j >= i - 5; j--) {
                const candidate = lines[j].replace(/\x1b\[[0-9;]*[mGKHFABCDJ]/g, '').trim();
                if (candidate && !/^[a-z]/.test(candidate) && candidate.length < 80) {
                    /* MUSH may append "(#NNNN)" or "[#NNNN Rf]" to the room name */
                    const dbrefMatch = candidate.match(/\(#(\d+)/) ?? candidate.match(/#(\d+)/);
                    if (dbrefMatch) {
                        roomDbref = dbrefMatch[1];
                    }
                    /* Strip the dbref/flag suffix for the display name */
                    roomName = candidate.replace(/\s*[\[(][^)\]]*[)\]].*$/, '').trim();
                    if (!roomName) roomName = candidate;
                    break;
                }
            }
            const exits = exitMatch[1]
                .split(/[,;]/)
                .map((e) => e.trim())
                .filter(Boolean);

            if (roomName || exits.length > 0) {
                onUpdate({ name: roomName, dbref: roomDbref, exits });
            }
        }
    }
}

/* ── DOM update helpers ── */

export function renderWhoPanel(el: HTMLElement, players: PlayerEntry[]): void {
    if (players.length === 0) {
        el.innerHTML = '<span class="dim">—</span>';
        return;
    }
    el.innerHTML = players
        .map(
            (p) =>
                `<div class="player-row">
                  <span class="player-name">${escHtml(p.name)}</span>
                  <span class="player-idle">${escHtml(p.idle)}</span>
                </div>`,
        )
        .join('');
}

export function renderRoomPanel(el: HTMLElement, info: RoomInfo): void {
    const dbrefSuffix = info.dbref ? ` <span style="color:var(--text-dim);font-size:.7rem">(#${escHtml(info.dbref)})</span>` : '';
    const name = info.name
        ? `<div style="margin-bottom:.4rem;font-weight:bold">${escHtml(info.name)}${dbrefSuffix}</div>`
        : '';
    const exits =
        info.exits.length > 0
            ? `<div class="dim" style="font-size:.72rem">Exits: ${info.exits.map(escHtml).join(' · ')}</div>`
            : '';
    el.innerHTML = name + exits || '<span class="dim">—</span>';
}

function escHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
