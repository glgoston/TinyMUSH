/* construction/map.ts — Cytoscape.js room-map panel for Construction Mode.
 *
 * Builds a directed graph incrementally as the player explores:
 *   - Each room is a node (identified by dbref when available, or a stable
 *     hash of the room name as fallback).
 *   - Each traversed exit becomes a directed edge labelled with the exit name.
 *   - The current room is highlighted; clicking a room teleports the player
 *     there (requires the room's dbref to be known).
 *   - The graph is persisted in sessionStorage so it survives page refresh
 *     within a single login session.
 */

import cytoscape from 'cytoscape';
import type { Core } from 'cytoscape';

const SESSION_KEY = 'tinymush_map_v1';

/* ── Internal data model ── */

interface RoomNode {
    id: string;       /* stable graph node ID, e.g. "r1234" or "nm3f8a2b" */
    name: string;
    dbref?: string;   /* numeric string, without "#" */
}

interface ExitEdge {
    id: string;
    source: string;
    target: string;
    label: string;
}

interface MapState {
    rooms: RoomNode[];
    exits: ExitEdge[];
}

/* ── ID helpers ── */

/** Produce a short, stable, CSS-safe ID for a room name (used when no dbref
 *  is available). Two rooms with the same name will collide — which is
 *  acceptable for the stream-parsed fallback path. */
function hashName(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
}

function makeNodeId(name: string, dbref?: string): string {
    return dbref ? `r${dbref}` : `nm${hashName(name)}`;
}

/* ── Cytoscape style sheet ── */

const MAP_STYLE = [
    {
        selector: 'node',
        style: {
            label: 'data(name)',
            'background-color': '#1a2a1a',
            'border-color': '#2a3a2a',
            'border-width': 1,
            color: '#8ba6a6',
            'font-size': 9,
            'text-valign': 'bottom' as const,
            'text-halign': 'center' as const,
            'text-margin-y': 5,
            width: 22,
            height: 22,
            shape: 'round-rectangle' as const,
            'text-wrap': 'wrap' as const,
            'text-max-width': '80px',
            'overlay-padding': '4px',
        },
    },
    {
        selector: 'node.current',
        style: {
            'background-color': '#00b894',
            'border-color': '#00d2a8',
            'border-width': 2,
            color: '#ffffff',
            'font-size': 10,
        },
    },
    {
        selector: 'node.visited',
        style: {
            'background-color': '#1e2e2a',
            'border-color': '#2a4a3a',
            color: '#c9d1d9',
        },
    },
    {
        selector: 'node:selected',
        style: {
            'border-color': '#ffa502',
            'border-width': 2,
        },
    },
    {
        selector: 'edge',
        style: {
            label: 'data(label)',
            'curve-style': 'bezier' as const,
            'target-arrow-shape': 'triangle' as const,
            'target-arrow-color': '#2a4a3a',
            'line-color': '#2a4a3a',
            color: '#586069',
            'font-size': 7,
            'text-rotation': 'autorotate' as const,
            width: 1,
            'arrow-scale': 0.6,
            'text-margin-y': -5,
        },
    },
];

/* ── Simple debounce ── */

function debounce(fn: () => void, ms: number): () => void {
    let timer: ReturnType<typeof setTimeout>;
    return (): void => {
        clearTimeout(timer);
        timer = setTimeout(fn, ms);
    };
}

/* ── RoomMap class ── */

export class RoomMap {
    private cy: Core | null = null;
    private container: HTMLElement;
    private sendCommand: (cmd: string) => void;

    private currentNodeId: string | null = null;
    private previousNodeId: string | null = null;
    private pendingExitName: string | null = null;

    private state: MapState = { rooms: [], exits: [] };
    private initialized = false;
    private resizeObserver: ResizeObserver | null = null;
    private relayoutDebounced: () => void;

    constructor(container: HTMLElement, sendCommand: (cmd: string) => void) {
        this.container = container;
        this.sendCommand = sendCommand;
        this.relayoutDebounced = debounce(() => this.relayout(), 400);
    }

    /** Mount Cytoscape into the container and restore any saved state. */
    init(): void {
        if (this.initialized) return;
        this.initialized = true;

        this.loadFromSession();

        const elements = [
            ...this.state.rooms.map((r) => ({
                data: { id: r.id, name: r.name, dbref: r.dbref ?? '' },
                classes: r.id === this.currentNodeId ? 'current' : 'visited',
            })),
            ...this.state.exits.map((e) => ({
                data: { id: e.id, source: e.source, target: e.target, label: e.label },
            })),
        ];

        this.cy = cytoscape({
            container: this.container,
            style: MAP_STYLE as Parameters<Core['style']>[0],
            elements,
            layout: this.layoutOptions(),
            minZoom: 0.2,
            maxZoom: 4,
            wheelSensitivity: 0.3,
        });

        /* Click-to-teleport */
        this.cy.on('tap', 'node', (evt) => {
            const dbref: string = evt.target.data('dbref');
            if (dbref) {
                this.sendCommand(`@tel me=#${dbref}`);
            }
        });

        /* Hover tooltip */
        this.cy.on('mouseover', 'node', (evt) => {
            const dbref: string = evt.target.data('dbref');
            const name: string = evt.target.data('name');
            this.container.title = dbref
                ? `${name} (#${dbref}) — click to teleport`
                : `${name} (dbref unknown)`;
        });
        this.cy.on('mouseout', 'node', () => {
            this.container.title = '';
        });

        /* Window / pane resize */
        this.resizeObserver = new ResizeObserver(() => {
            this.cy?.resize();
            this.cy?.fit(undefined, 20);
        });
        this.resizeObserver.observe(this.container);

        /* Restore current-room highlight */
        if (this.currentNodeId) {
            this.cy.$id(this.currentNodeId).addClass('current');
        }
    }

    /** Called every time the stream parser detects a new current room. */
    updateCurrentRoom(name: string, dbref?: string): void {
        const id = makeNodeId(name, dbref);

        /* Bookkeeping for edge creation */
        this.previousNodeId = this.currentNodeId;

        /* Clear old "current" highlight */
        if (this.currentNodeId) {
            this.cy?.$id(this.currentNodeId).removeClass('current').addClass('visited');
        }

        /* Add node if new */
        if (!this.state.rooms.find((r) => r.id === id)) {
            this.state.rooms.push({ id, name, dbref });
            this.cy?.add({
                group: 'nodes',
                data: { id, name, dbref: dbref ?? '' },
                classes: 'visited',
            });
            this.relayoutDebounced();
        } else if (dbref) {
            /* Back-fill the dbref if we now have it */
            const existing = this.state.rooms.find((r) => r.id === id);
            if (existing && !existing.dbref) {
                existing.dbref = dbref;
                this.cy?.$id(id).data('dbref', dbref);
            }
        }

        /* Highlight current */
        this.currentNodeId = id;
        this.cy?.$id(id).addClass('current').removeClass('visited');

        /* If a movement command was pending, draw the edge now */
        this.flushPendingEdge();

        this.saveToSession();
    }

    /** Record the last movement command typed by the player (used to label
     *  the edge drawn between the previous and next room). */
    recordMove(exitName: string): void {
        this.pendingExitName = exitName;
    }

    /** Exposes the current-room node ID (for the room form). */
    get currentId(): string | null {
        return this.currentNodeId;
    }

    fit(): void {
        if (!this.cy) return;
        if (this.cy.elements().length === 0) return;
        this.cy.fit(undefined, 20);
    }

    clearMap(): void {
        this.state = { rooms: [], exits: [] };
        this.currentNodeId = null;
        this.previousNodeId = null;
        this.pendingExitName = null;
        this.cy?.elements().remove();
        sessionStorage.removeItem(SESSION_KEY);
    }

    destroy(): void {
        this.resizeObserver?.disconnect();
        this.cy?.destroy();
        this.cy = null;
        this.initialized = false;
    }

    /* ── Private helpers ── */

    private flushPendingEdge(): void {
        if (
            !this.pendingExitName ||
            !this.previousNodeId ||
            !this.currentNodeId ||
            this.previousNodeId === this.currentNodeId
        ) {
            this.pendingExitName = null;
            return;
        }
        this.addEdge(this.previousNodeId, this.currentNodeId, this.pendingExitName);
        this.pendingExitName = null;
    }

    private addEdge(source: string, target: string, label: string): void {
        const id = `${source}__${target}__${label}`;
        if (this.state.exits.find((e) => e.id === id)) return;
        this.state.exits.push({ id, source, target, label });
        this.cy?.add({ data: { id, source, target, label } });
        this.saveToSession();
    }

    private relayout(): void {
        if (!this.cy) return;
        const opts = this.layoutOptions();
        this.cy.layout(opts).run();
    }

    private layoutOptions(): cytoscape.LayoutOptions {
        const roots = this.currentNodeId ? `#${this.currentNodeId}` : undefined;
        return {
            name: 'breadthfirst',
            directed: true,
            padding: 24,
            spacingFactor: 1.6,
            animate: this.cy !== null,
            animationDuration: 300,
            roots,
        } as cytoscape.LayoutOptions;
    }

    private saveToSession(): void {
        try {
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.state));
        } catch {
            /* sessionStorage quota exceeded — ignore silently */
        }
    }

    private loadFromSession(): void {
        try {
            const raw = sessionStorage.getItem(SESSION_KEY);
            if (raw) {
                this.state = JSON.parse(raw) as MapState;
            }
        } catch {
            this.state = { rooms: [], exits: [] };
        }
    }
}
