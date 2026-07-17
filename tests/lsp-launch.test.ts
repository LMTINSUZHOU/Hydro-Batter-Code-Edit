import { describe, expect, it } from 'vitest';
import {
    buildLspLaunch, isLspLaunchAvailable, normalizeLspLanguage,
} from '../src/lsp-launch';

const settings = {
    clangdCommand: 'clangd',
    pyrightCommand: 'bundled',
    jdtlsCommand: 'jdtls',
};

describe('language server launch configuration', () => {
    it('normalizes Hydro language aliases', () => {
        expect(normalizeLspLanguage('c_cpp')).toBe('cpp');
        expect(normalizeLspLanguage('python3')).toBe('python');
        expect(normalizeLspLanguage('java')).toBe('java');
        expect(normalizeLspLanguage('rust')).toBeUndefined();
    });

    it('builds shell-free commands for all three servers', () => {
        expect(buildLspLaunch('cpp', '/tmp/work', settings)).toMatchObject({
            command: 'clangd', args: ['--background-index=false'], fileName: 'main.cpp',
        });
        expect(buildLspLaunch('python', '/tmp/work', settings)).toMatchObject({
            command: process.execPath, serverName: 'Pyright', fileName: 'main.py',
        });
        expect(buildLspLaunch('python', '/tmp/work', settings).args.at(-1)).toBe('--stdio');
        expect(buildLspLaunch('java', '/tmp/work', settings)).toMatchObject({
            command: 'jdtls', args: ['-data', '/tmp/work'], fileName: 'Main.java',
        });
        expect(() => buildLspLaunch('cpp', '/tmp/work', { ...settings, clangdCommand: 'clangd\nrm' }))
            .toThrow('Invalid language server command');
    });

    it('always detects the bundled Pyright language server', () => {
        expect(isLspLaunchAvailable('python', settings)).toBe(true);
    });
});
