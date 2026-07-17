import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
    buildCppCompilationDatabase, buildLspLaunch, isLspLaunchAvailable, normalizeLspLanguage,
    resolveCppCompiler, resolveExecutable,
} from '../src/lsp-launch';

const localRuntime = resolve(__dirname, '..', '.hydro-batter-runtime');
const localTestCommand = resolve(localRuntime, 'bin', 'hydro-batter-test-command');

afterAll(async () => {
    await rm(localTestCommand, { force: true });
});

const settings = {
    clangdCommand: 'clangd',
    cppCompilerCommand: 'auto',
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
            command: 'clangd', args: ['--background-index=false'], fileName: 'main.cpp', compilerCommand: 'auto',
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
        expect(() => buildLspLaunch('cpp', '/tmp/work', { ...settings, cppCompilerCommand: 'g++\nrm' }))
            .toThrow('Invalid language server command');
    });

    it('creates a shell-free C++ compilation database for clangd', () => {
        expect(buildCppCompilationDatabase('/tmp/work', '/tmp/work/main.cpp', '/usr/bin/g++')).toEqual([{
            directory: '/tmp/work',
            file: '/tmp/work/main.cpp',
            arguments: ['/usr/bin/g++', '-std=c++17', '-fsyntax-only', '/tmp/work/main.cpp'],
        }]);
        expect(resolveCppCompiler(process.execPath)).toBe(process.execPath);
    });

    it('always detects the bundled Pyright language server', () => {
        expect(isLspLaunchAvailable('python', settings)).toBe(true);
    });

    it('finds plugin-local commands without relying on the PM2 PATH', async () => {
        await mkdir(resolve(localRuntime, 'bin'), { recursive: true });
        await writeFile(localTestCommand, '#!/bin/sh\nexit 0\n', 'utf8');
        await chmod(localTestCommand, 0o755);
        expect(resolveExecutable('hydro-batter-test-command')).toBe(localTestCommand);
    });
});
