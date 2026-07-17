import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
    encodeLspMessage, JsonRpcMessage, LspFrameDecoder,
} from '../src/lsp-protocol';

describe('bundled Pyright language server', () => {
    const cleanup: Array<() => Promise<void> | void> = [];
    afterEach(async () => {
        while (cleanup.length) await cleanup.pop()?.();
    });

    it('returns real member completions over stdio LSP', async () => {
        const workspace = await mkdtemp(join(tmpdir(), 'hydro-batter-pyright-test-'));
        cleanup.push(() => rm(workspace, { recursive: true, force: true }));
        const file = join(workspace, 'main.py');
        const code = 'items: list[int] = []\nitems.ap';
        await writeFile(file, code, 'utf8');
        const child = spawn(process.execPath, [require.resolve('pyright/langserver.index.js'), '--stdio'], {
            cwd: workspace,
            stdio: 'pipe',
        });
        cleanup.push(() => {
            if (child.exitCode === null) child.kill('SIGTERM');
        });
        const decoder = new LspFrameDecoder();
        let nextId = 1;
        const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
        const send = (message: JsonRpcMessage) => child.stdin.write(encodeLspMessage(message));
        const request = (method: string, params: any) => {
            const id = nextId++;
            send({ jsonrpc: '2.0', id, method, params });
            return new Promise<any>((resolve, reject) => pending.set(id, { resolve, reject }));
        };
        child.stdout.on('data', (chunk: Buffer) => {
            for (const message of decoder.push(chunk)) {
                if (message.method && message.id !== undefined) {
                    const result = message.method === 'workspace/configuration'
                        ? ((message.params as any)?.items || []).map(() => ({}))
                        : null;
                    send({ jsonrpc: '2.0', id: message.id, result });
                    continue;
                }
                if (typeof message.id !== 'number') continue;
                const callback = pending.get(message.id);
                if (!callback) continue;
                pending.delete(message.id);
                if (message.error) callback.reject(new Error(String((message.error as any).message || message.error)));
                else callback.resolve(message.result);
            }
        });
        const rootUri = pathToFileURL(`${workspace}${sep}`).toString();
        const documentUri = pathToFileURL(file).toString();
        await request('initialize', {
            processId: null,
            rootUri,
            workspaceFolders: [{ uri: rootUri, name: 'test' }],
            capabilities: {
                workspace: { configuration: true },
                textDocument: { completion: { completionItem: { snippetSupport: true } } },
            },
        });
        send({ jsonrpc: '2.0', method: 'initialized', params: {} });
        send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: {
            textDocument: { uri: documentUri, languageId: 'python', version: 1, text: code },
        } });
        const completion = await Promise.race([
            request('textDocument/completion', {
                textDocument: { uri: documentUri },
                position: { line: 1, character: 8 },
                context: { triggerKind: 1 },
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Pyright completion timed out')), 10000)),
        ]);
        const items = Array.isArray(completion) ? completion : (completion as any)?.items;
        expect(items?.some((item: any) => item.label === 'append')).toBe(true);
    }, 15000);
});
