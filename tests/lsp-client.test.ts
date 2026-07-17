import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    getLspClient, getLspEngineStatus, prepareLspModel,
} from '../frontend/lsp-client';

class FakeWebSocket {
    static OPEN = 1;
    static instances: FakeWebSocket[] = [];
    readyState = FakeWebSocket.OPEN;
    sent: string[] = [];
    onmessage?: (event: { data: string }) => void;
    onerror?: () => void;
    onclose?: (event: { code: number; reason: string }) => void;

    constructor(public url: string) {
        FakeWebSocket.instances.push(this);
    }

    send(value: string) {
        this.sent.push(value);
    }

    emit(value: unknown) {
        this.onmessage?.({ data: typeof value === 'string' ? value : JSON.stringify(value) });
    }

    close(code = 1000, reason = '') {
        this.readyState = 3;
        this.onclose?.({ code, reason });
    }
}

function messages(socket: FakeWebSocket) {
    return socket.sent.filter((value) => value.startsWith('{')).map((value) => JSON.parse(value));
}

function tick() {
    return new Promise((resolve) => setTimeout(resolve));
}

describe('browser LSP client', () => {
    afterEach(() => {
        FakeWebSocket.instances = [];
        vi.restoreAllMocks();
    });

    it('initializes, synchronizes, completes and publishes diagnostics', async () => {
        const changeListeners: Array<(event: any) => void> = [];
        const disposeListeners: Array<() => void> = [];
        let code = 'vector<int> values;\nvalues.pu';
        let version = 1;
        const model: any = {
            getValue: () => code,
            getVersionId: () => version,
            getWordUntilPosition: () => ({ startColumn: 8, endColumn: 10 }),
            isDisposed: () => false,
            onDidChangeContent: (listener: (event: any) => void) => {
                changeListeners.push(listener);
                return { dispose: () => undefined };
            },
            onWillDispose: (listener: () => void) => {
                disposeListeners.push(listener);
                return { dispose: () => undefined };
            },
        };
        const setModelMarkers = vi.fn();
        const completionKinds = {
            Text: 0, Method: 1, Function: 2, Constructor: 3, Field: 4, Variable: 5, Class: 6,
            Interface: 7, Module: 8, Property: 9, Unit: 10, Value: 11, Enum: 12, Keyword: 13,
            Snippet: 14, Color: 15, File: 16, Reference: 17, Folder: 18, EnumMember: 19, Constant: 20,
            Struct: 21, Event: 22, Operator: 23, TypeParameter: 24,
        };
        const monaco: any = {
            MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
            MarkerTag: { Unnecessary: 1, Deprecated: 2 },
            editor: { setModelMarkers },
            languages: {
                CompletionItemKind: completionKinds,
                CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
                CompletionItemTag: { Deprecated: 1 },
            },
        };
        (globalThis as any).window = {
            location: { href: 'https://oj.example.com/p/1' },
            UserContext: { _id: 1 },
            UiContext: {
                ws_prefix: '/',
                hydroBatterCodeEdit: { lspEnabled: true, lspLanguages: ['cpp'] },
            },
        };
        (globalThis as any).document = { documentElement: { lang: 'zh-CN' }, cookie: '' };
        (globalThis as any).WebSocket = FakeWebSocket;
        const onStatus = vi.fn();

        const connecting = prepareLspModel(model, 'c_cpp', monaco, onStatus)!;
        const socket = FakeWebSocket.instances[0];
        expect(socket.url).toBe('wss://oj.example.com/hydro-batter-code-edit/lsp/cpp');
        socket.emit({ hydroBatterLsp: {
            type: 'ready', language: 'cpp', server: 'clangd',
            documentUri: 'file:///tmp/work/main.cpp', rootUri: 'file:///tmp/work/',
        } });
        await tick();
        const initialize = messages(socket).find((message) => message.method === 'initialize');
        expect(initialize.params.initializationOptions.fallbackFlags).toEqual(['-std=c++17']);
        socket.emit({ jsonrpc: '2.0', id: initialize.id, result: {
            capabilities: { textDocumentSync: 2, completionProvider: { resolveProvider: true } },
        } });
        await tick();
        expect(getLspClient(model)?.state).toBe('ready');
        expect(messages(socket).find((message) => message.method === 'textDocument/didOpen')?.params.textDocument.text).toBe(code);

        code = 'vector<int> values;\nvalues.push';
        version += 1;
        changeListeners[0]({ changes: [{
            range: { startLineNumber: 2, startColumn: 8, endLineNumber: 2, endColumn: 10 },
            rangeLength: 2,
            text: 'push',
        }] });
        expect(messages(socket).filter((message) => message.method === 'textDocument/didChange').at(-1)?.params.contentChanges[0])
            .toMatchObject({ text: 'push', range: { start: { line: 1, character: 7 } } });

        const completionPromise = connecting.completionItems(
            { lineNumber: 2, column: 12 } as any,
            { triggerKind: 1 } as any,
        );
        await tick();
        const completion = messages(socket).filter((message) => message.method === 'textDocument/completion').at(-1);
        expect(completion.params.context.triggerKind).toBe(2);
        socket.emit({ jsonrpc: '2.0', id: completion.id, result: { items: [{
            label: 'push_back', kind: 2, insertText: 'push_back(${1:value})', insertTextFormat: 2,
            textEdit: {
                insert: { start: { line: 1, character: 7 }, end: { line: 1, character: 11 } },
                replace: { start: { line: 1, character: 7 }, end: { line: 1, character: 12 } },
                newText: 'push_back(${1:value})',
            },
        }] } });
        const completionItems = await completionPromise;
        expect(completionItems).toEqual([
            expect.objectContaining({
                label: 'push_back', insertText: 'push_back(${1:value})', kind: completionKinds.Method,
                range: {
                    insert: { startLineNumber: 2, startColumn: 8, endLineNumber: 2, endColumn: 12 },
                    replace: { startLineNumber: 2, startColumn: 8, endLineNumber: 2, endColumn: 13 },
                },
            }),
        ]);
        const resolvePromise = connecting.resolveCompletionItem(completionItems[0]);
        await tick();
        const resolve = messages(socket).filter((message) => message.method === 'completionItem/resolve').at(-1);
        socket.emit({ jsonrpc: '2.0', id: resolve.id, result: {
            label: 'push_back', kind: 2, insertText: 'push_back(${1:value})', insertTextFormat: 2,
            additionalTextEdits: [{
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                newText: '#include <vector>\n',
            }],
        } });
        await expect(resolvePromise).resolves.toMatchObject({
            additionalTextEdits: [{ text: '#include <vector>\n' }],
        });

        socket.emit({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: {
            uri: 'file:///tmp/work/main.cpp',
            diagnostics: [{
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
                severity: 1,
                message: 'unknown type name',
                source: 'clangd',
            }],
        } });
        expect(setModelMarkers).toHaveBeenLastCalledWith(model, 'hydro-batter-code-edit-lsp', [
            expect.objectContaining({ severity: 8, message: 'unknown type name', startLineNumber: 1 }),
        ]);
        expect(connecting.diagnosticCount).toBe(1);
        expect(getLspEngineStatus().readyLanguages).toContain('cpp');

        socket.emit('ping');
        expect(socket.sent.at(-1)).toBe('pong');
        connecting.dispose();
        expect(getLspEngineStatus().connections).toBe(0);
    });
});
