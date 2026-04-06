import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
    root: '.',
    build: {
        outDir: 'dist/public',
        emptyOutDir: true,
    },
    resolve: {
        alias: {
            '@client': path.resolve(__dirname, 'src/client'),
        },
    },
    server: {
        port: 5173,
        // In dev mode, proxy API and WebSocket calls to the tsx server on :3000
        proxy: {
            '/api': 'http://localhost:3000',
            '/ws': {
                target: 'ws://localhost:3000',
                ws: true,
            },
        },
    },
});
