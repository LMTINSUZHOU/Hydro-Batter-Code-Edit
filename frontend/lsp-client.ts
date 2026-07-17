import type * as Monaco from 'monaco-editor';
import { normalizeLanguage } from '../src/catalog';

type LspState = 'connecting' | 'initializing' | 'ready' | 'failed' | 'disposed';

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: any;
  result?: any;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRequest {
  resolve(value: any): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface GatewayReady {
  type: 'ready';
  language: string;
  server: string;
  documentUri: string;
  rootUri: string;
}

const MARKER_OWNER = 'hydro-batter-code-edit-lsp';
const clients = new WeakMap<Monaco.editor.ITextModel, LspDocumentClient>();
const activeClients = new Set<LspDocumentClient>();

function publicConfig(): any {
  return (window as any).UiContext?.hydroBatterCodeEdit || {};
}

function isAvailable(language: string): boolean {
  const config = publicConfig();
  return Boolean((window as any).UserContext?._id)
    && config.lspEnabled !== false
    && Array.isArray(config.lspLanguages)
    && config.lspLanguages.includes(normalizeLanguage(language));
}

function websocketUrl(language: string): string {
  const context = (window as any).UiContext || {};
  const prefix = typeof context.ws_prefix === 'string' && context.ws_prefix ? context.ws_prefix : '/';
  const base = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const url = new URL(`${base}hydro-batter-code-edit/lsp/${encodeURIComponent(language)}`, window.location.href);
  if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.host !== window.location.host && document.cookie.includes('sid=')) {
    url.searchParams.set('sid', document.cookie.split('sid=')[1].split(';')[0]);
  }
  return url.toString();
}

function lspPosition(position: Monaco.IPosition) {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}

function monacoRange(range: any): Monaco.IRange {
  return {
    startLineNumber: Number(range?.start?.line || 0) + 1,
    startColumn: Number(range?.start?.character || 0) + 1,
    endLineNumber: Number(range?.end?.line || 0) + 1,
    endColumn: Number(range?.end?.character || 0) + 1,
  };
}

function markdown(value: any): Monaco.IMarkdownString | string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return { value };
  if (Array.isArray(value)) {
    return { value: value.map((item) => {
      if (typeof item === 'string') return item;
      if (typeof item?.value === 'string' && item.language) return `\`\`\`${item.language}\n${item.value}\n\`\`\``;
      return typeof item?.value === 'string' ? item.value : '';
    }).filter(Boolean).join('\n\n') };
  }
  if (typeof value.value !== 'string') return undefined;
  return value.language
    ? { value: `\`\`\`${value.language}\n${value.value}\n\`\`\`` }
    : { value: value.value };
}

function completionRange(
  edit: any,
  defaultEditRange: any,
  fallback: Monaco.IRange,
): Monaco.IRange | Monaco.languages.CompletionItemRanges {
  const candidate = edit?.insert || edit?.replace || edit?.range ? edit : defaultEditRange;
  if (candidate?.insert && candidate?.replace) {
    return { insert: monacoRange(candidate.insert), replace: monacoRange(candidate.replace) };
  }
  const range = candidate?.range || candidate;
  return range?.start && range?.end ? monacoRange(range) : fallback;
}

function completionKind(monaco: typeof Monaco, kind: number | undefined): Monaco.languages.CompletionItemKind {
  const kinds = monaco.languages.CompletionItemKind;
  const mapping: Record<number, Monaco.languages.CompletionItemKind> = {
    1: kinds.Text, 2: kinds.Method, 3: kinds.Function, 4: kinds.Constructor,
    5: kinds.Field, 6: kinds.Variable, 7: kinds.Class, 8: kinds.Interface,
    9: kinds.Module, 10: kinds.Property, 11: kinds.Unit, 12: kinds.Value,
    13: kinds.Enum, 14: kinds.Keyword, 15: kinds.Snippet, 16: kinds.Color,
    17: kinds.File, 18: kinds.Reference, 19: kinds.Folder, 20: kinds.EnumMember,
    21: kinds.Constant, 22: kinds.Struct, 23: kinds.Event, 24: kinds.Operator,
    25: kinds.TypeParameter,
  };
  return mapping[kind || 0] ?? kinds.Text;
}

function markerSeverity(monaco: typeof Monaco, severity?: number): Monaco.MarkerSeverity {
  if (severity === 1) return monaco.MarkerSeverity.Error;
  if (severity === 2) return monaco.MarkerSeverity.Warning;
  if (severity === 4) return monaco.MarkerSeverity.Hint;
  return monaco.MarkerSeverity.Info;
}

export class LspDocumentClient {
  readonly language: string;
  state: LspState = 'connecting';
  serverName?: string;
  error?: string;
  diagnosticCount = 0;
  private socket?: WebSocket;
  private documentUri?: string;
  private rootUri?: string;
  private nextRequestId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private capabilities: any = {};
  private disposables: Monaco.IDisposable[];

  constructor(
    private model: Monaco.editor.ITextModel,
    language: string,
    private monaco: typeof Monaco,
    private onStatusChange: () => void,
  ) {
    this.language = normalizeLanguage(language);
    this.disposables = [
      model.onDidChangeContent((event) => this.syncDocument(event)),
      model.onWillDispose(() => this.dispose()),
    ];
    activeClients.add(this);
    this.connect();
  }

  private setState(state: LspState, error?: string) {
    this.state = state;
    this.error = error;
    this.onStatusChange();
  }

  private connect() {
    try {
      this.socket = new WebSocket(websocketUrl(this.language));
      this.socket.onmessage = (event) => this.handleMessage(event.data);
      this.socket.onerror = () => {
        this.setState('failed', 'Language server WebSocket failed.');
        this.socket?.close();
      };
      this.socket.onclose = (event) => {
        if (this.state === 'disposed') return;
        this.rejectPending(new Error(event.reason || 'Language server connection closed.'));
        this.clearDiagnostics();
        this.setState('failed', event.reason || 'Language server connection closed.');
      };
    } catch (error) {
      this.setState('failed', error instanceof Error ? error.message : String(error));
    }
  }

  private send(message: JsonRpcMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('Language server connection is not open.');
    this.socket.send(JSON.stringify({ jsonrpc: '2.0', ...message }));
  }

  private notify(method: string, params?: any) {
    this.send({ method, params });
  }

  private rawRequest(method: string, params: any, timeout = 10000): Promise<any> {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  request(method: string, params: any, timeout = 12000): Promise<any> {
    if (this.state !== 'ready') return Promise.reject(new Error('Language server is not ready.'));
    return this.rawRequest(method, params, timeout);
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private async handleGateway(message: any) {
    if (message.type === 'ready') {
      const ready = message as GatewayReady;
      this.documentUri = ready.documentUri;
      this.rootUri = ready.rootUri;
      this.serverName = ready.server;
      await this.initialize();
      return;
    }
    if (message.type === 'error' || message.type === 'stopped') {
      this.setState('failed', message.message || 'Language server stopped.');
      this.socket?.close(4000, 'Language server stopped');
    }
  }

  private handleMessage(raw: string) {
    if (raw === 'ping') {
      this.socket?.send('pong');
      return;
    }
    if (raw === 'pong') return;
    let message: JsonRpcMessage & { hydroBatterLsp?: any };
    try {
      message = JSON.parse(raw);
    } catch {
      this.setState('failed', 'Language server returned invalid JSON.');
      return;
    }
    if (message.hydroBatterLsp) {
      void this.handleGateway(message.hydroBatterLsp).catch((error) => {
        this.setState('failed', error instanceof Error ? error.message : String(error));
        this.socket?.close(4000, 'Language server initialization failed');
      });
      return;
    }
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id as number | string);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id as number | string);
      if (message.error) pending.reject(new Error(message.error.message || 'Language server request failed.'));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message);
      return;
    }
    if (message.method === 'textDocument/publishDiagnostics') this.publishDiagnostics(message.params);
    else if (message.method === 'window/showMessage' && Number(message.params?.type) <= 2) {
      console.warn(`${this.serverName || 'Language server'}: ${message.params?.message || ''}`);
    }
  }

  private handleServerRequest(message: JsonRpcMessage) {
    let result: any = null;
    if (message.method === 'workspace/configuration') {
      result = (message.params?.items || []).map((item: any) => {
        if (item?.section === 'python.analysis') return { typeCheckingMode: 'basic', diagnosticMode: 'openFilesOnly' };
        if (item?.section === 'python') return { analysis: { typeCheckingMode: 'basic', diagnosticMode: 'openFilesOnly' } };
        return {};
      });
    } else if (message.method === 'workspace/workspaceFolders') {
      result = this.rootUri ? [{ uri: this.rootUri, name: 'HydroOJ submission' }] : null;
    } else if (message.method === 'workspace/applyEdit') {
      result = { applied: false, failureReason: 'Server-initiated workspace edits are disabled.' };
    }
    try {
      this.send({ id: message.id, result });
    } catch { /* Connection closed while replying. */ }
  }

  private initializationOptions(): any {
    if (this.language === 'cpp') return { fallbackFlags: ['-std=c++17'] };
    if (this.language === 'java') return { settings: { java: { import: { gradle: { enabled: false } } } } };
    return {};
  }

  private async initialize() {
    if (!this.documentUri || !this.rootUri) return;
    this.setState('initializing');
    const result = await this.rawRequest('initialize', {
      processId: null,
      clientInfo: { name: 'Hydro Batter Code Edit', version: '1.4.0-pre.1' },
      locale: document.documentElement.lang || 'zh-CN',
      rootUri: this.rootUri,
      workspaceFolders: [{ uri: this.rootUri, name: 'HydroOJ submission' }],
      initializationOptions: this.initializationOptions(),
      capabilities: {
        workspace: { configuration: true, workspaceFolders: true },
        textDocument: {
          synchronization: { dynamicRegistration: false, willSave: false, didSave: false },
          completion: {
            completionItem: {
              snippetSupport: true,
              commitCharactersSupport: true,
              documentationFormat: ['markdown', 'plaintext'],
              deprecatedSupport: true,
              preselectSupport: true,
              insertReplaceSupport: true,
              resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
            },
            completionList: { itemDefaults: ['commitCharacters', 'editRange', 'insertTextFormat', 'insertTextMode', 'data'] },
          },
          signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'], parameterInformation: { labelOffsetSupport: true } } },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] }, versionSupport: true },
        },
      },
    }, 45000);
    this.capabilities = result?.capabilities || {};
    this.notify('initialized', {});
    this.notify('workspace/didChangeConfiguration', {
      settings: this.language === 'python'
        ? { python: { analysis: { typeCheckingMode: 'basic', diagnosticMode: 'openFilesOnly' } } }
        : {},
    });
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri: this.documentUri,
        languageId: this.language,
        version: this.model.getVersionId(),
        text: this.model.getValue(),
      },
    });
    this.setState('ready');
  }

  private syncDocument(event: Monaco.editor.IModelContentChangedEvent) {
    if (this.state !== 'ready' || !this.documentUri || this.model.isDisposed()) return;
    try {
      const synchronization = this.capabilities?.textDocumentSync;
      const changeKind = typeof synchronization === 'number' ? synchronization : synchronization?.change;
      const contentChanges = changeKind === 2 ? event.changes.map((change) => ({
        range: {
          start: { line: change.range.startLineNumber - 1, character: change.range.startColumn - 1 },
          end: { line: change.range.endLineNumber - 1, character: change.range.endColumn - 1 },
        },
        rangeLength: change.rangeLength,
        text: change.text,
      })) : [{ text: this.model.getValue() }];
      this.notify('textDocument/didChange', {
        textDocument: { uri: this.documentUri, version: this.model.getVersionId() },
        contentChanges,
      });
    } catch (error) {
      this.setState('failed', error instanceof Error ? error.message : String(error));
    }
  }

  private publishDiagnostics(params: any) {
    if (params?.uri !== this.documentUri || this.model.isDisposed()) return;
    if (publicConfig().diagnostics === false) {
      this.clearDiagnostics();
      return;
    }
    const diagnostics = Array.isArray(params?.diagnostics) ? params.diagnostics : [];
    this.diagnosticCount = diagnostics.length;
    this.monaco.editor.setModelMarkers(this.model, MARKER_OWNER, diagnostics.map((item: any) => ({
      ...monacoRange(item.range),
      severity: markerSeverity(this.monaco, item.severity),
      message: String(item.message || 'Language server diagnostic'),
      source: item.source || this.serverName || 'LSP',
      code: typeof item.code === 'object' ? item.code?.value : item.code,
      tags: Array.isArray(item.tags) ? item.tags.map((tag: number) => (
        tag === 1 ? this.monaco.MarkerTag.Unnecessary : this.monaco.MarkerTag.Deprecated
      )) : undefined,
    })));
    this.onStatusChange();
  }

  private textDocumentPosition(position: Monaco.IPosition) {
    return { textDocument: { uri: this.documentUri }, position: lspPosition(position) };
  }

  async completionItems(
    position: Monaco.IPosition,
    context: Monaco.languages.CompletionContext,
  ): Promise<Monaco.languages.CompletionItem[]> {
    const response = await this.request('textDocument/completion', {
      ...this.textDocumentPosition(position),
      context: { triggerKind: context.triggerKind + 1, triggerCharacter: context.triggerCharacter },
    });
    const rawItems = Array.isArray(response) ? response : response?.items;
    if (!Array.isArray(rawItems)) return [];
    const defaults = Array.isArray(response) ? {} : response?.itemDefaults || {};
    return rawItems.map((item: any, index: number) => this.toCompletionItem(item, defaults, position, index));
  }

  private toCompletionItem(item: any, defaults: any, position: Monaco.IPosition, index: number): Monaco.languages.CompletionItem {
    const label = typeof item.label === 'string' ? item.label : String(item.label?.label || '');
    const edit = item.textEdit;
    const word = this.model.getWordUntilPosition(position);
    const fallbackRange: Monaco.IRange = {
      startLineNumber: position.lineNumber,
      startColumn: word.startColumn,
      endLineNumber: position.lineNumber,
      endColumn: word.endColumn,
    };
    const insertTextFormat = item.insertTextFormat || defaults.insertTextFormat;
    const suggestion: Monaco.languages.CompletionItem = {
      label,
      detail: item.detail || item.labelDetails?.description,
      documentation: markdown(item.documentation),
      kind: completionKind(this.monaco, item.kind),
      insertText: edit?.newText ?? item.textEditText ?? item.insertText ?? label,
      insertTextRules: insertTextFormat === 2
        ? this.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
      range: completionRange(edit, defaults.editRange, fallbackRange),
      sortText: `000${item.sortText || index.toString().padStart(5, '0')}`,
      filterText: item.filterText,
      preselect: item.preselect,
      commitCharacters: item.commitCharacters || defaults.commitCharacters,
      additionalTextEdits: Array.isArray(item.additionalTextEdits)
        ? item.additionalTextEdits.map((additional: any) => ({ range: monacoRange(additional.range), text: additional.newText }))
        : undefined,
      tags: item.deprecated || item.tags?.includes(1)
        ? [this.monaco.languages.CompletionItemTag.Deprecated]
        : undefined,
    };
    (suggestion as any).__hydroBatterLsp = { client: this, raw: item, defaults, position };
    return suggestion;
  }

  async resolveCompletionItem(item: Monaco.languages.CompletionItem): Promise<Monaco.languages.CompletionItem> {
    const metadata = (item as any).__hydroBatterLsp;
    if (!metadata || metadata.client !== this || !this.capabilities?.completionProvider?.resolveProvider) return item;
    const resolved = await this.request('completionItem/resolve', metadata.raw);
    return {
      ...item,
      ...this.toCompletionItem({ ...metadata.raw, ...resolved }, metadata.defaults, metadata.position, 0),
    };
  }

  async signatureHelp(position: Monaco.IPosition, context: Monaco.languages.SignatureHelpContext): Promise<Monaco.languages.SignatureHelpResult | null> {
    const value = await this.request('textDocument/signatureHelp', {
      ...this.textDocumentPosition(position),
      context: {
        triggerKind: context.triggerKind,
        triggerCharacter: context.triggerCharacter,
        isRetrigger: context.isRetrigger,
        activeSignatureHelp: context.activeSignatureHelp,
      },
    });
    if (!value?.signatures?.length) return null;
    return {
      value: {
        activeSignature: value.activeSignature || 0,
        activeParameter: value.activeParameter || 0,
        signatures: value.signatures.map((signature: any) => ({
          label: signature.label,
          documentation: markdown(signature.documentation),
          parameters: (signature.parameters || []).map((parameter: any) => ({
            label: parameter.label,
            documentation: markdown(parameter.documentation),
          })),
          activeParameter: signature.activeParameter,
        })),
      },
      dispose: () => undefined,
    };
  }

  async hover(position: Monaco.IPosition): Promise<Monaco.languages.Hover | null> {
    const value = await this.request('textDocument/hover', this.textDocumentPosition(position));
    const contents = markdown(value?.contents);
    if (!contents) return null;
    return {
      contents: Array.isArray(contents) ? contents : [typeof contents === 'string' ? { value: contents } : contents],
      range: value.range ? monacoRange(value.range) : undefined,
    };
  }

  async formatting(options: Monaco.languages.FormattingOptions): Promise<Monaco.languages.TextEdit[]> {
    const value = await this.request('textDocument/formatting', {
      textDocument: { uri: this.documentUri },
      options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces, trimTrailingWhitespace: true },
    }, 15000);
    return Array.isArray(value) ? value.map((edit: any) => ({ range: monacoRange(edit.range), text: edit.newText })) : [];
  }

  private clearDiagnostics() {
    if (!this.model.isDisposed()) this.monaco.editor.setModelMarkers(this.model, MARKER_OWNER, []);
    this.diagnosticCount = 0;
  }

  dispose() {
    if (this.state === 'disposed') return;
    if (this.state === 'ready' && this.documentUri && this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.notify('textDocument/didClose', { textDocument: { uri: this.documentUri } });
      } catch { /* Connection is already closing. */ }
    }
    activeClients.delete(this);
    this.setState('disposed');
    this.rejectPending(new Error('Language server client disposed.'));
    this.clearDiagnostics();
    this.disposables.forEach((disposable) => disposable.dispose());
    this.socket?.close(1000, 'Editor disposed');
  }
}

export function prepareLspModel(
  model: Monaco.editor.ITextModel,
  language: string,
  monaco: typeof Monaco,
  onStatusChange: () => void,
): LspDocumentClient | undefined {
  if (typeof WebSocket === 'undefined' || !isAvailable(language)) return undefined;
  const normalized = normalizeLanguage(language);
  const existing = clients.get(model);
  if (existing?.language === normalized && existing.state !== 'disposed') return existing;
  existing?.dispose();
  const client = new LspDocumentClient(model, normalized, monaco, onStatusChange);
  clients.set(model, client);
  return client;
}

export function getLspClient(model: Monaco.editor.ITextModel): LspDocumentClient | undefined {
  const client = clients.get(model);
  return client?.state === 'ready' ? client : undefined;
}

export function getLspEngineStatus() {
  const configuredLanguages = Array.isArray(publicConfig().lspLanguages) ? publicConfig().lspLanguages : [];
  const current = Array.from(activeClients);
  return {
    configuredLanguages,
    connections: current.length,
    readyLanguages: Array.from(new Set(current.filter((client) => client.state === 'ready').map((client) => client.language))).sort(),
    servers: Object.fromEntries(current.filter((client) => client.serverName).map((client) => [client.language, client.serverName])),
    failures: Object.fromEntries(current.filter((client) => client.error).map((client) => [client.language, client.error])),
  };
}
