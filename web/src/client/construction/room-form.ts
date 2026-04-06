/* construction/room-form.ts — @dig room builder form for Construction Mode.
 *
 * Renders a GUI form inside the "Rooms" tab.  On submit it synthesises the
 * correct sequence of MUSH commands and sends them via sendCommand():
 *
 *   @dig <name>=<exit-here>,<exit-back>
 *   @desc #dbref=<description>
 *   @parent #dbref=#parent
 *   @zone #dbref=#zone
 *   @set #dbref=SAFE
 *
 * It also watches for the MUSH "Room created" confirmation so it can update
 * its own UI state after a successful dig.
 */

export class RoomForm {
    private container: HTMLElement;
    private sendCommand: (cmd: string) => void;
    private onCreated: ((name: string) => void) | null;

    private currentRoomName = '';
    private currentDbref = '';

    constructor(
        container: HTMLElement,
        sendCommand: (cmd: string) => void,
        onCreated?: (name: string) => void,
    ) {
        this.container = container;
        this.sendCommand = sendCommand;
        this.onCreated = onCreated ?? null;
        this.render();
    }

    setCurrentRoom(name: string, dbref?: string): void {
        this.currentRoomName = name;
        this.currentDbref = dbref ?? '';
        const label = this.container.querySelector<HTMLElement>('.rf-current-room');
        if (label) {
            label.textContent = dbref ? `${name} (#${dbref})` : name;
        }
    }

    /** Check a raw terminal line for a room-creation confirmation and call
     *  back if found.  Returns the new room dbref if detected. */
    onTerminalLine(line: string): string | null {
        /* TinyMUSH outputs: "RoomName created as room #1234."
         *                or "#1234 created."                 */
        const m = line.match(/created[^\n#]*#(\d+)/i) ?? line.match(/#(\d+)[^\n]*created/i);
        if (m) {
            const dbref = m[1];
            const statusEl = this.container.querySelector<HTMLElement>('.rf-status');
            if (statusEl) {
                statusEl.textContent = `Room #${dbref} created successfully.`;
                statusEl.className = 'rf-status rf-status-ok';
                setTimeout(() => { statusEl.textContent = ''; }, 4000);
            }
            this.onCreated?.(dbref);
            return dbref;
        }
        return null;
    }

    render(): void {
        this.container.innerHTML = /* html */ `
<div class="rf-wrap">
  <div class="rf-section-title">Current room</div>
  <div class="rf-current-room rf-dim">${this.currentRoomName || '—'}</div>

  <div class="rf-section-title" style="margin-top:.9rem">Dig a new room</div>
  <form class="rf-form" id="rf-form" autocomplete="off">
    <label class="rf-label" for="rf-name">Room name <span class="rf-req">*</span></label>
    <input class="rf-input" id="rf-name" type="text" placeholder="The Kitchen" required />

    <label class="rf-label" for="rf-exit-here">Exit from here</label>
    <input class="rf-input" id="rf-exit-here" type="text" placeholder="north;n" />

    <label class="rf-label" for="rf-exit-back">Return exit</label>
    <input class="rf-input" id="rf-exit-back" type="text" placeholder="south;s" />

    <label class="rf-label" for="rf-desc">Description</label>
    <textarea class="rf-input rf-textarea" id="rf-desc" rows="3" placeholder="A description of the room…"></textarea>

    <div class="rf-row">
      <div class="rf-col">
        <label class="rf-label" for="rf-parent">Parent (dbref)</label>
        <input class="rf-input" id="rf-parent" type="text" placeholder="#0" pattern="#?\\d*" />
      </div>
      <div class="rf-col">
        <label class="rf-label" for="rf-zone">Zone (dbref)</label>
        <input class="rf-input" id="rf-zone" type="text" placeholder="#dbref" pattern="#?\\d*" />
      </div>
    </div>

    <div class="rf-check-row">
      <input type="checkbox" id="rf-safe" /><label for="rf-safe">Set SAFE flag</label>
    </div>

    <div class="rf-status" style="display:none"></div>
    <div class="rf-actions">
      <button class="rf-btn rf-btn-primary" type="submit">⛏ Dig room</button>
      <button class="rf-btn rf-btn-ghost" type="reset">Clear</button>
    </div>
  </form>

  <div class="rf-section-title" style="margin-top:1rem">Quick commands</div>
  <div class="rf-quick">
    <button class="rf-btn rf-btn-ghost rf-quick-btn" data-cmd="look">look</button>
    <button class="rf-btn rf-btn-ghost rf-quick-btn" data-cmd="examine here">examine here</button>
    <button class="rf-btn rf-btn-ghost rf-quick-btn" data-cmd="@desc here=">@desc here=</button>
  </div>
</div>`;

        const form = this.container.querySelector<HTMLFormElement>('#rf-form')!;

        /* Show/hide the status div */
        form.querySelector<HTMLElement>('.rf-status')!.style.display = 'block';

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.submit(form);
        });

        /* Quick-command buttons */
        this.container.querySelectorAll<HTMLButtonElement>('.rf-quick-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.sendCommand(btn.dataset.cmd ?? '');
            });
        });
    }

    private submit(form: HTMLFormElement): void {
        const name = (form.querySelector<HTMLInputElement>('#rf-name')?.value ?? '').trim();
        if (!name) return;

        const exitHere = (form.querySelector<HTMLInputElement>('#rf-exit-here')?.value ?? '').trim();
        const exitBack = (form.querySelector<HTMLInputElement>('#rf-exit-back')?.value ?? '').trim();
        const desc     = (form.querySelector<HTMLTextAreaElement>('#rf-desc')?.value ?? '').trim();
        const parent   = normalizeDbref(form.querySelector<HTMLInputElement>('#rf-parent')?.value ?? '');
        const zone     = normalizeDbref(form.querySelector<HTMLInputElement>('#rf-zone')?.value ?? '');
        const safe     = form.querySelector<HTMLInputElement>('#rf-safe')?.checked ?? false;

        /* ── Build the @dig command ── */
        let digCmd = `@dig ${name}`;
        if (exitHere || exitBack) {
            digCmd += `=${exitHere},${exitBack}`;
        }
        this.sendCommand(digCmd);

        /* ── Post-dig commands are sent after a short delay to give the server
         *    time to create the object.  We use a basic chain delay here;
         *    the "Room #NNNN created" confirmation in onTerminalLine() is the
         *    authoritative signal but delays are needed for robustness. ── */
        const queue: Array<{ cmd: string; delay: number }> = [];
        let t = 600; /* ms after @dig */

        if (desc) {
            /* We don't know the new dbref yet — use the name and hope the
             * server accepts @desc <name>=... before the player arrives.
             * The structured-output channel (Phase 5) will fix this properly. */
            queue.push({ cmd: `@desc ${name}=${desc}`, delay: t });
            t += 300;
        }
        if (parent) {
            queue.push({ cmd: `@par ${name}=${parent}`, delay: t });
            t += 300;
        }
        if (zone) {
            queue.push({ cmd: `@zone ${name}=${zone}`, delay: t });
            t += 300;
        }
        if (safe) {
            queue.push({ cmd: `@set ${name}=SAFE`, delay: t });
            t += 300;
        }

        queue.forEach(({ cmd, delay }) => {
            setTimeout(() => this.sendCommand(cmd), delay);
        });

        /* Provide visual feedback */
        const statusEl = this.container.querySelector<HTMLElement>('.rf-status');
        if (statusEl) {
            statusEl.textContent = `Digging "${name}"…`;
            statusEl.className = 'rf-status rf-status-pending';
        }
    }
}

/* ── Helpers ── */

function normalizeDbref(raw: string): string {
    const s = raw.trim();
    if (!s) return '';
    return s.startsWith('#') ? s : `#${s}`;
}
