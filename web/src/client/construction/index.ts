/* construction/index.ts — Construction Mode controller.
 *
 * Responsibilities:
 *  - Detect whether the connected character has BUILDER/wizard status by
 *    sending a capability probe right after login.
 *  - Show / hide the ⚒ Build button based on that result.
 *  - Toggle the side-pane between "play panels" (Who / Location) and
 *    "build panels" (Map / Rooms / Exits).
 *  - Fan out parsed room data and raw terminal lines to the three sub-panels.
 *  - Track movement commands (n / south / go …) so the map can draw edges
 *    between successive rooms.
 *
 * All game actions ultimately go through sendCommand() which writes to the
 * existing WebSocket connection — nothing bypasses the game engine.
 */

import { RoomMap }     from './map';
import { RoomForm }    from './room-form';
import { ExitManager } from './exit-manager';
import type { RoomInfo } from '../panels';

/* ── Capability probe ── */

/** Send 'examine me' to read the character's flags and check for BUILDER/wizard status.
 *  examine output includes a "Flags:" line that we parse. */
const CAP_CMD = 'examine me';
const CAP_YES_RE = /(?:Flags|FLAGS):[^\n]*(BUILDER|WIZARD)/i;

/* ── Movement-command heuristic ── */

const DIRECTION_RE =
    /^(?:n(?:orth)?|s(?:outh)?|e(?:ast)?|w(?:est)?|ne|nw|se|sw|u(?:p)?|d(?:own)?|in|out|go\s+\S+|enter\s+\S+)$/i;

/* ── Module state ── */

let sendFn: (cmd: string) => void = () => { /* not yet wired */ };
let active  = false;
let capable = false;

let buildBtn:    HTMLButtonElement | null = null;
let playPanels:  HTMLElement | null = null;
let buildPanels: HTMLElement | null = null;
let currentTab = 'map';

let roomMap:  RoomMap     | null = null;
let roomForm: RoomForm    | null = null;
let exitMgr:  ExitManager | null = null;

/* ── Init ── */

export interface ConstructionElements {
    buildBtn:   HTMLButtonElement;
    playPanels: HTMLElement;
    buildPanels: HTMLElement;
}

/** Called once after login succeeds and the DOM is ready. */
export function initConstruction(
    send: (cmd: string) => void,
    els: ConstructionElements,
): void {
    sendFn     = send;
    buildBtn   = els.buildBtn;
    playPanels = els.playPanels;
    buildPanels = els.buildPanels;

    /* Tab switching */
    buildPanels.querySelectorAll<HTMLButtonElement>('.build-tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab ?? 'map'));
    });

    /* Build toggle */
    buildBtn.addEventListener('click', () => {
        if (active) disableBuildMode();
        else        enableBuildMode();
    });

    /* Depth slider */
    const depthInput = buildPanels.querySelector<HTMLInputElement>('#build-depth');
    const depthLabel = buildPanels.querySelector<HTMLElement>('#build-depth-label');
    if (depthInput && depthLabel) {
        depthInput.addEventListener('input', () => {
            depthLabel.textContent = depthInput.value;
        });
    }

    /* Clear-map button */
    buildPanels.querySelector<HTMLButtonElement>('#build-map-clear')
        ?.addEventListener('click', () => {
            if (confirm('Clear the room map? This cannot be undone.')) {
                roomMap?.clearMap();
            }
        });

    /* Fit-map button */
    buildPanels.querySelector<HTMLButtonElement>('#build-map-fit')
        ?.addEventListener('click', () => roomMap?.fit());

    /* Sub-panel containers */
    const mapContainer  = document.getElementById('build-tab-map')!;
    const roomContainer = document.getElementById('build-tab-rooms')!;
    const exitContainer = document.getElementById('build-tab-exits')!;

    roomMap  = new RoomMap(mapContainer, send);
    roomForm = new RoomForm(roomContainer, send, () => { /* room created callback */ });
    exitMgr  = new ExitManager(exitContainer, send);
}

/** Send the capability probe. Should be called once the WebSocket is open. */
export function checkCapability(send: (cmd: string) => void): void {
    console.log('[Construction] Sending capability probe: ' + CAP_CMD);
    send(CAP_CMD);
}

/* ── Stream hooks ── */

/** Called with every raw line of text arriving from the MUSH. */
export function onTerminalLine(line: string): void {
    const clean = stripAnsi(line);

    /* Capability response */
    if (!capable && CAP_YES_RE.test(clean)) {
        console.log('[Construction] BUILDER/WIZARD capability confirmed');
        capable = true;
        buildBtn?.classList.remove('hidden');
        return;
    }

    /* Room-creation confirmation (delegated to room-form for status display) */
    if (active) {
        roomForm?.onTerminalLine(clean);
    }
}

/** Called with the structured RoomInfo every time the stream parser detects
 *  a room look / description block. */
export function onRoomUpdate(info: RoomInfo): void {
    roomMap?.updateCurrentRoom(info.name, info.dbref);
    roomForm?.setCurrentRoom(info.name, info.dbref);
    exitMgr?.setCurrentRoom(info.name, info.exits, info.dbref);
}

/** Called with every command the player sends, so we can track movement. */
export function onCommandSent(cmd: string): void {
    if (!roomMap) return;
    const trimmed = cmd.trim();
    if (DIRECTION_RE.test(trimmed)) {
        roomMap.recordMove(trimmed.replace(/^go\s+/i, '').replace(/^enter\s+/i, ''));
    }
}

/* ── Mode toggle ── */

function enableBuildMode(): void {
    active = true;
    buildBtn!.classList.add('active');
    playPanels!.classList.add('hidden');
    buildPanels!.classList.remove('hidden');

    /* Lazily initialise Cytoscape (requires the container to be visible). */
    roomMap?.init();

    switchTab(currentTab);
}

function disableBuildMode(): void {
    active = false;
    buildBtn!.classList.remove('active');
    playPanels!.classList.remove('hidden');
    buildPanels!.classList.add('hidden');
}

/* ── Tab switching ── */

function switchTab(tabId: string): void {
    currentTab = tabId;

    buildPanels!.querySelectorAll<HTMLButtonElement>('.build-tab-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    buildPanels!.querySelectorAll<HTMLElement>('.build-tab-content').forEach((el) => {
        el.classList.toggle('hidden', el.id !== `build-tab-${tabId}`);
    });

    if (tabId === 'map') {
        /* A small rAF delay lets the container finish becoming visible so
         * Cytoscape can read the correct dimensions before fitting. */
        requestAnimationFrame(() => roomMap?.fit());
    }
}

/* ── Utility ── */

function stripAnsi(s: string): string {
    return s.replace(/\x1b\[[0-9;]*[mGKHFABCDJ]/g, '');
}
