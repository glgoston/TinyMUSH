import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

export type ResizeCallback = (cols: number, rows: number) => void;

export function createTerminal(container: HTMLElement, onResize: ResizeCallback): Terminal {
    const fitAddon = new FitAddon();
    const unicode11 = new Unicode11Addon();
    const webLinks = new WebLinksAddon();

    const term = new Terminal({
        fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", "DejaVu Sans Mono", "Courier New", monospace',
        fontSize: 14,
        lineHeight: 1.2,
        letterSpacing: 0,
        cursorBlink: true,
        cursorStyle: 'block',
        allowProposedApi: true,  /* required for Unicode11Addon */
        convertEol: true,        /* normalise LF from the MUSH to CRLF */
        scrollback: 5000,
        theme: {
            background:    '#0d0d0d',
            foreground:    '#c9d1d9',
            cursor:        '#00b894',
            cursorAccent:  '#000000',
            selectionBackground: 'rgba(0,184,148,.25)',
            /* Standard ANSI colours */
            black:         '#0a0a0a',
            red:           '#ff4757',
            green:         '#00b894',
            yellow:        '#ffa502',
            blue:          '#4f9bff',
            magenta:       '#c56cf0',
            cyan:          '#00cec9',
            white:         '#c9d1d9',
            /* Bright variants */
            brightBlack:   '#586069',
            brightRed:     '#ff6b81',
            brightGreen:   '#55efc4',
            brightYellow:  '#ffdd59',
            brightBlue:    '#74b9ff',
            brightMagenta: '#fd79a8',
            brightCyan:    '#81ecec',
            brightWhite:   '#ffffff',
        },
    });

    term.loadAddon(fitAddon);
    term.loadAddon(unicode11);
    term.loadAddon(webLinks);

    /* Activate Unicode 11 (covers Box Drawing, Braille, CJK characters) */
    term.unicode.activeVersion = '11';

    term.open(container);
    fitAddon.fit();

    /* Propagate terminal size changes (drag-to-resize gutter or window resize) */
    const ro = new ResizeObserver(() => {
        fitAddon.fit();
        onResize(term.cols, term.rows);
    });
    ro.observe(container);

    return term;
}
