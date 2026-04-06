/* construction/exit-manager.ts — Exit table panel for Construction Mode.
 *
 * Displays the exits of the current room in a table and provides buttons to
 * create, open, or examine individual exits.
 *
 * In the stream-parsing phase (Phase 1-3) we only know exit *names* from the
 * "Obvious exits:" line — we do not have per-exit dbrefs or destinations.
 * The Create form lets builders add new exits by typing name + destination.
 * Examine/delete buttons become available once the structured-output channel
 * (Phase 5) is implemented and we learn dbrefs.
 */

export class ExitManager {
    private container: HTMLElement;
    private sendCommand: (cmd: string) => void;

    private currentRoomName = '';
    private currentDbref = '';
    private currentExits: string[] = [];

    constructor(container: HTMLElement, sendCommand: (cmd: string) => void) {
        this.container = container;
        this.sendCommand = sendCommand;
        this.render();
    }

    setCurrentRoom(name: string, exits: string[], dbref?: string): void {
        this.currentRoomName = name;
        this.currentDbref = dbref ?? '';
        this.currentExits = exits;
        this.render();
    }

    render(): void {
        const roomLabel = this.currentDbref
            ? `${this.currentRoomName} (#${this.currentDbref})`
            : (this.currentRoomName || '—');

        this.container.innerHTML = /* html */ `
<div class="em-wrap">
  <div class="rf-section-title">Exits from <span class="em-room-name">${escHtml(roomLabel)}</span></div>

  <table class="em-table">
    <thead>
      <tr>
        <th>Name / aliases</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody id="em-body">
      ${this.currentExits.length === 0
          ? `<tr><td colspan="2" class="em-empty">No exits detected yet – try <em>look</em></td></tr>`
          : this.currentExits.map((ex) => this.exitRow(ex)).join('')}
    </tbody>
  </table>

  <div class="rf-section-title" style="margin-top:.9rem">Create a new exit</div>
  <form class="rf-form" id="em-form" autocomplete="off">
    <div class="rf-row">
      <div class="rf-col">
        <label class="rf-label" for="em-name">Exit name / aliases <span class="rf-req">*</span></label>
        <input class="rf-input" id="em-name" type="text" placeholder="north;n;nor" required />
      </div>
      <div class="rf-col">
        <label class="rf-label" for="em-dest">Destination (dbref) <span class="rf-req">*</span></label>
        <input class="rf-input" id="em-dest" type="text" placeholder="#1234" required pattern="#?\\d+" />
      </div>
    </div>
    <div class="rf-actions">
      <button class="rf-btn rf-btn-primary" type="submit">+ Open exit</button>
    </div>
  </form>

  <div class="rf-section-title" style="margin-top:.9rem">Quick commands</div>
  <div class="rf-quick">
    <button class="rf-btn rf-btn-ghost rf-quick-btn" data-cmd="examine here">examine here</button>
    <button class="rf-btn rf-btn-ghost rf-quick-btn" data-cmd="@list exits here">list exits</button>
  </div>
</div>`;

        /* Wire up open-exit form */
        const form = this.container.querySelector<HTMLFormElement>('#em-form')!;
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.createExit(form);
        });

        /* Wire up per-row action buttons (examine) */
        this.container.querySelectorAll<HTMLButtonElement>('.em-btn-examine').forEach((btn) => {
            btn.addEventListener('click', () => {
                const exitName = btn.dataset.exit ?? '';
                if (exitName) this.sendCommand(`examine ${exitName}`);
            });
        });

        /* Quick commands */
        this.container.querySelectorAll<HTMLButtonElement>('.rf-quick-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                this.sendCommand(btn.dataset.cmd ?? '');
            });
        });
    }

    /* ── Private helpers ── */

    private exitRow(exitName: string): string {
        return /* html */ `
<tr>
  <td class="em-exit-name">${escHtml(exitName)}</td>
  <td class="em-actions">
    <button class="rf-btn rf-btn-ghost em-btn-examine"
            data-exit="${escHtml(exitName)}">examine</button>
  </td>
</tr>`;
    }

    private createExit(form: HTMLFormElement): void {
        const name = (form.querySelector<HTMLInputElement>('#em-name')?.value ?? '').trim();
        const dest = normalizeDbref(
            (form.querySelector<HTMLInputElement>('#em-dest')?.value ?? '').trim(),
        );
        if (!name || !dest) return;

        this.sendCommand(`@open ${name}=${dest}`);

        /* Optimistically add the exit to the list so the UI feels responsive */
        if (!this.currentExits.includes(name)) {
            this.currentExits = [...this.currentExits, name];
        }
        form.reset();
        this.render();
    }
}

/* ── Helpers ── */

function escHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function normalizeDbref(raw: string): string {
    const s = raw.trim();
    if (!s) return '';
    return s.startsWith('#') ? s : `#${s}`;
}
