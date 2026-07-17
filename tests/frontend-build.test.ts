import { resolve } from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { treeSitterBrowserEsbuildPlugin } from '../src/tree-sitter-esbuild';

describe('Hydro frontend bundle', () => {
    it('bundles Tree-sitter for a browser IIFE without Node built-ins', async () => {
        const result = await build({
            entryPoints: [resolve('frontend/editor-enhancer.page.ts')],
            bundle: true,
            format: 'iife',
            platform: 'browser',
            target: ['chrome65'],
            write: false,
            external: ['@hydrooj/ui-default'],
            plugins: [treeSitterBrowserEsbuildPlugin],
            logLevel: 'silent',
        });
        const javascript = result.outputFiles?.[0]?.text || '';
        expect(javascript.length).toBeGreaterThan(100_000);
        expect(javascript).not.toContain('await import("fs/promises")');
        expect(javascript).not.toContain('await import("module")');
    });
});
