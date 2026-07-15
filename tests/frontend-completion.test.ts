import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
    callback: undefined as ((pageName: string) => Promise<void>) | undefined,
    monaco: undefined as any,
}));

vi.mock('@hydrooj/ui-default', () => ({
    $: () => ({ val: () => '' }),
    addPage: () => undefined,
    AutoloadPage: class {
        constructor(_name: string, callback: (pageName: string) => Promise<void>) {
            harness.callback = callback;
        }
    },
    i18n: (key: string) => key,
    loadMonaco: async () => ({
        monaco: harness.monaco,
        registerAction: () => undefined,
        customOptions: {},
    }),
    Notification: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

describe('frontend completion integration', () => {
    beforeEach(() => {
        vi.resetModules();
        harness.callback = undefined;
    });

    it('autoloads on an arbitrary Hydro page and registers the real Monaco language id', async () => {
        const providers = new Map<string, any>();
        harness.monaco = {
            languages: {
                CompletionItemKind: {
                    Keyword: 1, Class: 2, Function: 3, Constant: 4, Module: 5, Property: 6, Snippet: 7,
                },
                CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
                registerCompletionItemProvider: (language: string, provider: any) => {
                    providers.set(language, provider);
                    return { dispose: () => undefined };
                },
            },
            editor: {
                getEditors: () => [],
                onDidCreateEditor: () => ({ dispose: () => undefined }),
            },
        };

        const windowMock: any = {
            UiContext: {
                hydroBatterCodeEdit: {
                    version: '1.0.3',
                    enabled: true,
                    completion: true,
                    templates: false,
                    formatting: false,
                    diagnostics: false,
                    autosave: false,
                },
            },
            LANGS: {
                'cc.custom': { monaco: 'c_cpp', highlight: 'cpp' },
                'py.custom': { monaco: 'python3', highlight: 'python' },
                java: { monaco: 'java', highlight: 'java astyle-java' },
            },
            addEventListener: () => undefined,
        };
        const documentMock: any = {
            getElementById: () => null,
            createElement: () => ({ style: {}, dataset: {} }),
            head: { appendChild: () => undefined },
            documentElement: { dataset: {} },
            querySelector: () => null,
        };
        const storageMock = {
            length: 0,
            key: () => null,
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
        };
        vi.stubGlobal('window', windowMock);
        vi.stubGlobal('document', documentMock);
        vi.stubGlobal('localStorage', storageMock);
        vi.spyOn(console, 'info').mockImplementation(() => undefined);

        await import('../frontend/editor-enhancer.page');
        expect(harness.callback).toBeTypeOf('function');
        await harness.callback?.('site_specific_problem_page');

        expect(providers.has('c_cpp')).toBe(true);
        expect(providers.has('python3')).toBe(true);
        expect(providers.has('java')).toBe(true);
        expect(windowMock.HydroBatterCodeEdit).toMatchObject({
            version: '1.0.3',
            serverVersion: '1.0.3',
            loaded: true,
            pageName: 'site_specific_problem_page',
            completionEnabled: true,
        });

        const result = providers.get('c_cpp').provideCompletionItems({
            getLanguageId: () => 'c_cpp',
            getWordUntilPosition: () => ({ startColumn: 1, endColumn: 3 }),
            getValueInRange: () => 'qu',
        }, { lineNumber: 1, column: 3 });
        expect(result.suggestions.some((item: any) => item.label === 'queue')).toBe(true);
        expect(windowMock.HydroBatterCodeEdit.lastCompletion).toEqual({
            language: 'c_cpp',
            prefix: 'qu',
            count: 1,
        });
    });

    it('expands a unique prefix through the native Tab fallback without addAction', async () => {
        const keydownHandlers: Array<(event: KeyboardEvent) => void> = [];
        const executeEdits = vi.fn();
        const addAction = vi.fn();
        const domNode = {
            addEventListener: (type: string, handler: (event: KeyboardEvent) => void) => {
                if (type === 'keydown') keydownHandlers.push(handler);
            },
            removeEventListener: () => undefined,
            querySelector: () => null,
        };
        const model = {
            getLanguageId: () => 'cpp',
            getWordUntilPosition: () => ({ startColumn: 1, endColumn: 3 }),
            getValueInRange: () => 'qu',
            onDidChangeContent: () => ({ dispose: () => undefined }),
        };
        const editor = {
            _standaloneKeybindingService: null,
            addAction,
            addOverlayWidget: () => undefined,
            executeEdits,
            focus: () => undefined,
            getContribution: () => null,
            getDomNode: () => domNode,
            getModel: () => model,
            getPosition: () => ({ lineNumber: 1, column: 3 }),
            getRawOptions: () => ({
                acceptSuggestionOnEnter: 'on',
                quickSuggestions: { other: true },
                quickSuggestionsDelay: 0,
                snippetSuggestions: 'top',
                suggestOnTriggerCharacters: true,
                tabCompletion: 'on',
            }),
            hasTextFocus: () => true,
            onDidChangeConfiguration: () => ({ dispose: () => undefined }),
            onDidChangeModel: () => ({ dispose: () => undefined }),
            onDidDispose: () => ({ dispose: () => undefined }),
            pushUndoStop: () => true,
            removeOverlayWidget: () => undefined,
            updateOptions: () => undefined,
        };
        harness.monaco = {
            Range: class {
                constructor(
                    public startLineNumber: number,
                    public startColumn: number,
                    public endLineNumber: number,
                    public endColumn: number,
                ) { }
            },
            languages: {
                CompletionItemKind: {
                    Keyword: 1, Class: 2, Function: 3, Constant: 4, Module: 5, Property: 6, Snippet: 7,
                },
                CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
                registerCompletionItemProvider: () => ({ dispose: () => undefined }),
            },
            editor: {
                OverlayWidgetPositionPreference: { BOTTOM_RIGHT_CORNER: 1 },
                getEditors: () => [editor],
                onDidCreateEditor: () => ({ dispose: () => undefined }),
            },
        };
        const windowMock: any = {
            UiContext: {
                hydroBatterCodeEdit: {
                    version: '1.0.3',
                    enabled: true,
                    completion: true,
                    templates: true,
                    formatting: false,
                    diagnostics: false,
                    autosave: true,
                },
            },
            LANGS: { cc: { monaco: 'cpp', highlight: 'cpp' } },
            addEventListener: () => undefined,
        };
        vi.stubGlobal('window', windowMock);
        vi.stubGlobal('document', {
            getElementById: () => null,
            createElement: () => ({ style: {}, dataset: {} }),
            head: { appendChild: () => undefined },
            documentElement: { dataset: {} },
            querySelector: () => null,
        });
        vi.stubGlobal('localStorage', {
            length: 0,
            key: () => null,
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
        });
        vi.spyOn(console, 'info').mockImplementation(() => undefined);

        await import('../frontend/editor-enhancer.page');
        await harness.callback?.('problem_detail');

        let propagationStopped = false;
        const event = {
            key: 'Tab',
            code: 'Tab',
            altKey: false,
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            isComposing: false,
            preventDefault: vi.fn(),
            stopImmediatePropagation: () => { propagationStopped = true; },
        } as unknown as KeyboardEvent;
        for (const handler of keydownHandlers) {
            handler(event);
            if (propagationStopped) break;
        }

        expect(addAction).not.toHaveBeenCalled();
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(executeEdits).toHaveBeenCalledWith(
            'hydro-batter-tab-completion',
            [expect.objectContaining({ text: 'queue' })],
        );
    });
});
