import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    buildCppCompilationDatabase, resolveCppCompiler, resolveExecutable,
} from '../src/lsp-launch';

const clangd = resolveExecutable('clangd');
const compiler = resolveCppCompiler('auto');

describe('clangd GCC toolchain integration', () => {
    const cleanup: string[] = [];
    afterEach(async () => {
        while (cleanup.length) await rm(cleanup.pop()!, { recursive: true, force: true });
    });

    it.skipIf(!clangd || !compiler)('parses bits/stdc++.h through the trusted query driver', async () => {
        const workspace = await mkdtemp(join(tmpdir(), 'hydro-batter-clangd-test-'));
        cleanup.push(workspace);
        const documentPath = join(workspace, 'main.cpp');
        await writeFile(
            documentPath,
            '#include <bits/stdc++.h>\nint main() { std::vector<int> v; return (int)v.size(); }\n',
            'utf8',
        );
        await writeFile(
            join(workspace, 'compile_commands.json'),
            JSON.stringify(buildCppCompilationDatabase(workspace, documentPath, compiler!), null, 2),
            'utf8',
        );

        const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
            const child = spawn(clangd!, [
                '--background-index=false',
                `--query-driver=${compiler}`,
                `--compile-commands-dir=${workspace}`,
                `--check=${documentPath}`,
            ], { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
            let output = '';
            child.stdout.on('data', (chunk) => { output += chunk.toString(); });
            child.stderr.on('data', (chunk) => { output += chunk.toString(); });
            child.once('error', reject);
            child.once('exit', (code) => resolve({ code, output }));
        });

        expect(result.code, result.output).toBe(0);
        expect(result.output).not.toMatch(/bits\/stdc\+\+\.h.*(?:not found|no such file)/i);
    }, 15000);
});
