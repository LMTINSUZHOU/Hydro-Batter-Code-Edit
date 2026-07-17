import {
  addPage, AutoloadPage, i18n, loadMonaco, Notification,
} from '@hydrooj/ui-default';
import type * as Monaco from 'monaco-editor';
import {
  CompletionSymbolKind, getCompletionSnippets, getCompletionSymbols, getSupportedLanguages,
  getTemplates, getUniqueCompletionSymbol, normalizeLanguage,
} from '../src/catalog';
import { getAutoImportEdit } from '../src/auto-import';
import {
  analyzeCompletionDocument, CompletionAnalysis, getIdeCompletionResult, getIdeSignatureHelp,
  IdeCompletionKind,
} from '../src/completion-engine';
import { diagnoseCode } from '../src/diagnostics';
import {
  cleanupExpiredDrafts, clearDraft, DraftContext, readDraft, writeDraft,
} from '../src/drafts';
import { formatCode, supportsFallbackFormatting } from '../src/formatter';
import { BatterEditorConfig, DEFAULT_EDITOR_CONFIG } from '../types';
import {
  getReadySyntaxFacts, getSyntaxEngineStatus, prepareSyntaxModel,
} from './tree-sitter-service';
import {
  getLspClient, getLspEngineStatus, LspDocumentClient, prepareLspModel,
} from './lsp-client';

const PLUGIN_VERSION = '1.3.0';
const MARKER_OWNER = 'hydro-batter-code-edit';
const supportedLanguages = new Set(getSupportedLanguages());
const sessions = new Set<EditorSession>();
const attachedEditors = new WeakMap<Monaco.editor.IStandaloneCodeEditor, EditorSession>();
const completionProviderLanguages = new Set<string>();
const signatureProviderLanguages = new Set<string>();
const formattingProviderLanguages = new Set<string>();
const hoverProviderLanguages = new Set<string>();
const languageBindings = new Map<string, string>();
const completionAnalysisCache = new WeakMap<Monaco.editor.ITextModel, {
  language: string;
  version: number;
  analysis: CompletionAnalysis;
}>();

let monacoApi: typeof Monaco;
let config: BatterEditorConfig;
let providerDisposables: Monaco.IDisposable[] = [];

interface RuntimeStatus {
  version: string;
  serverVersion?: string;
  loaded: boolean;
  pageName: string;
  completionEnabled: boolean;
  registeredLanguages: string[];
  editorCount: number;
  completionRequests: number;
  syntaxEngine: ReturnType<typeof getSyntaxEngineStatus>;
  lspEngine: ReturnType<typeof getLspEngineStatus>;
  lastCompletion?: {
    language: string;
    prefix: string;
    count: number;
    context: 'global' | 'include' | 'import' | 'member';
  };
  error?: string;
}

const runtimeStatus: RuntimeStatus = {
  version: PLUGIN_VERSION,
  serverVersion: (window as any).UiContext?.hydroBatterCodeEdit?.version,
  loaded: false,
  pageName: '',
  completionEnabled: false,
  registeredLanguages: [],
  editorCount: 0,
  completionRequests: 0,
  syntaxEngine: getSyntaxEngineStatus(),
  lspEngine: getLspEngineStatus(),
};
(window as any).HydroBatterCodeEdit = runtimeStatus;

function getConfig(): BatterEditorConfig {
  return {
    ...DEFAULT_EDITOR_CONFIG,
    ...((window as any).UiContext?.hydroBatterCodeEdit || {}),
  };
}

function installStyles() {
  if (document.getElementById('hydro-batter-code-edit-styles')) return;
  const style = document.createElement('style');
  style.id = 'hydro-batter-code-edit-styles';
  style.textContent = `
    .hydro-batter-status {
      pointer-events: none; margin: 0 14px 8px 0; padding: 3px 8px; border-radius: 4px;
      color: var(--text-2, #666); background: #fff;
      background: color-mix(in srgb, var(--background-color, #fff) 88%, transparent);
      box-shadow: 0 1px 4px rgba(0, 0, 0, .12); font: 12px/1.5 sans-serif;
    }
    .hydro-batter-status[data-level="warning"] { color: #9a6700; }
    .hydro-batter-template-backdrop {
      position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center;
      padding: 20px; background: rgba(0, 0, 0, .45);
    }
    .hydro-batter-template-dialog {
      width: min(560px, 100%); max-height: min(620px, 90vh); overflow: auto; padding: 20px;
      border-radius: 8px; color: var(--text-color, #222); background: var(--background-color, #fff);
      box-shadow: 0 16px 48px rgba(0, 0, 0, .28);
    }
    .hydro-batter-template-dialog h2 { margin: 0 0 14px; font-size: 20px; }
    .hydro-batter-template-item {
      display: block; width: 100%; margin: 8px 0; padding: 12px 14px; border: 1px solid #ddd;
      border-radius: 6px; color: inherit; background: transparent; text-align: left; cursor: pointer;
    }
    .hydro-batter-template-item:hover, .hydro-batter-template-item:focus { border-color: #5672cd; background: rgba(86, 114, 205, .08); }
    .hydro-batter-template-item strong, .hydro-batter-template-item span { display: block; }
    .hydro-batter-template-item span { margin-top: 4px; color: var(--text-2, #666); font-size: 13px; }
    .hydro-batter-template-cancel { margin-top: 12px; }
  `;
  document.head.appendChild(style);
}

function resolveCatalogLanguage(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !candidate) continue;
    const normalized = normalizeLanguage(candidate);
    if (supportedLanguages.has(normalized) || supportsFallbackFormatting(normalized)) return normalized;
  }
  return '';
}

function collectLanguageBindings(): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const language of supportedLanguages) bindings.set(language, language);
  const hydroLanguages = (window as any).LANGS || {};
  for (const [languageKey, rawConfig] of Object.entries<any>(hydroLanguages)) {
    const languageConfig = rawConfig || {};
    const highlight = typeof languageConfig.highlight === 'string'
      ? languageConfig.highlight.split(/\s+/)[0]
      : '';
    const monacoLanguage = String(languageConfig.monaco || highlight || languageKey || '');
    const catalogLanguage = resolveCatalogLanguage(
      monacoLanguage,
      highlight,
      languageKey,
    );
    if (monacoLanguage && catalogLanguage) bindings.set(monacoLanguage, catalogLanguage);
  }
  return bindings;
}

function catalogLanguageFor(monacoLanguage: string): string {
  return languageBindings.get(monacoLanguage)
    || resolveCatalogLanguage(monacoLanguage);
}

function getCompletionAnalysis(model: Monaco.editor.ITextModel, language: string): CompletionAnalysis {
  const version = model.getVersionId();
  const syntaxFacts = getReadySyntaxFacts(model, language);
  const cached = completionAnalysisCache.get(model);
  const expectedEngine = syntaxFacts ? 'tree-sitter' : 'fallback';
  if (cached?.version === version
    && cached.language === language
    && cached.analysis.syntaxEngine === expectedEngine) return cached.analysis;
  const analysis = analyzeCompletionDocument(model.getValue(), language, syntaxFacts);
  completionAnalysisCache.set(model, { language, version, analysis });
  return analysis;
}

function completionRange(
  model: Monaco.editor.ITextModel,
  replacement: { start: number; end: number },
): Monaco.IRange {
  const start = model.getPositionAt(replacement.start);
  const end = model.getPositionAt(replacement.end);
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  };
}

function fallbackCompletionItems(
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  catalogLanguage: string,
): Monaco.languages.CompletionItem[] {
  const language = catalogLanguageFor(model.getLanguageId()) || catalogLanguage;
  const code = model.getValue();
  const offset = model.getOffsetAt(position);
  const ideCompletion = getIdeCompletionResult(getCompletionAnalysis(model, language), code, offset);
  const word = model.getWordUntilPosition(position);
  const range = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };
  const prefix = ideCompletion.prefix || model.getValueInRange(range);
  const query = prefix.toLowerCase();
  const snippets = ideCompletion.exclusive ? [] : getCompletionSnippets(language).filter((snippet) => !query
    || snippet.prefix.toLowerCase().startsWith(query)
    || snippet.label.toLowerCase().startsWith(query));
  const semanticLabels = new Set(ideCompletion.items.map((item) => item.label));
  const symbols = ideCompletion.exclusive ? [] : getCompletionSymbols(language, prefix)
    .filter((symbol) => !semanticLabels.has(symbol.label));
  runtimeStatus.completionRequests += 1;
  runtimeStatus.lastCompletion = {
    language: model.getLanguageId(),
    prefix,
    count: ideCompletion.items.length + snippets.length + symbols.length,
    context: ideCompletion.context,
  };
  const symbolKinds: Record<CompletionSymbolKind, Monaco.languages.CompletionItemKind> = {
    keyword: monaco.languages.CompletionItemKind.Keyword,
    class: monaco.languages.CompletionItemKind.Class,
    function: monaco.languages.CompletionItemKind.Function,
    constant: monaco.languages.CompletionItemKind.Constant,
    module: monaco.languages.CompletionItemKind.Module,
    property: monaco.languages.CompletionItemKind.Property,
  };
  const ideKinds: Record<IdeCompletionKind, Monaco.languages.CompletionItemKind> = {
    class: monaco.languages.CompletionItemKind.Class,
    constant: monaco.languages.CompletionItemKind.Constant,
    constructor: monaco.languages.CompletionItemKind.Constructor,
    enum: monaco.languages.CompletionItemKind.Enum,
    field: monaco.languages.CompletionItemKind.Field,
    function: monaco.languages.CompletionItemKind.Function,
    interface: monaco.languages.CompletionItemKind.Interface,
    method: monaco.languages.CompletionItemKind.Method,
    module: monaco.languages.CompletionItemKind.Module,
    property: monaco.languages.CompletionItemKind.Property,
    variable: monaco.languages.CompletionItemKind.Variable,
  };
  return [
    ...ideCompletion.items.map((item, index) => {
      const autoImport = item.autoImport ? getAutoImportEdit(code, language, item.label) : undefined;
      return {
        label: item.label,
        detail: autoImport ? `${item.detail} · ${autoImport.description}` : item.detail,
        documentation: item.documentation || item.detail,
        filterText: item.filterText || item.label,
        insertText: item.insertText,
        insertTextRules: item.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
        kind: ideKinds[item.kind],
        preselect: index === 0,
        range: item.replacement ? completionRange(model, item.replacement) : range,
        sortText: `10${item.sortText}`,
        additionalTextEdits: autoImport ? [{ range: completionRange(model, autoImport), text: autoImport.text }] : undefined,
      };
    }),
    ...snippets.map((snippet, index) => ({
      label: snippet.label,
      detail: snippet.detail,
      documentation: snippet.detail,
      filterText: `${snippet.prefix} ${snippet.label}`,
      insertText: snippet.body,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      kind: monaco.languages.CompletionItemKind.Snippet,
      range,
      sortText: `20${index.toString().padStart(2, '0')}`,
    })),
    ...symbols.map((symbol) => {
      const autoImport = getAutoImportEdit(code, language, symbol.label);
      return {
        label: symbol.label,
        detail: autoImport ? `${symbol.detail} · ${autoImport.description}` : symbol.detail,
        documentation: symbol.detail,
        filterText: symbol.label,
        insertText: symbol.insertText || symbol.label,
        kind: symbolKinds[symbol.kind],
        range,
        sortText: `30${symbol.label.toLowerCase()}`,
        additionalTextEdits: autoImport ? [{ range: completionRange(model, autoImport), text: autoImport.text }] : undefined,
      };
    }),
  ];
}

function ensureCompletionProvider(
  monaco: typeof Monaco,
  monacoLanguage: string,
  catalogLanguage: string,
) {
  if (!config.completion || !catalogLanguage || completionProviderLanguages.has(monacoLanguage)) return;
  completionProviderLanguages.add(monacoLanguage);
  try {
    providerDisposables.push(monaco.languages.registerCompletionItemProvider(monacoLanguage, {
      async provideCompletionItems(model, position, context) {
        const language = catalogLanguageFor(model.getLanguageId()) || catalogLanguage;
        void prepareSyntaxModel(model, language).then(() => {
          runtimeStatus.syntaxEngine = getSyntaxEngineStatus();
        });
        const fallback = fallbackCompletionItems(monaco, model, position, catalogLanguage);
        const lsp = getLspClient(model);
        if (!lsp) return { suggestions: fallback };
        const seen = new Set<string>();
        const unique = (items: Monaco.languages.CompletionItem[]) => items.filter((item) => {
          const label = typeof item.label === 'string' ? item.label : item.label.label;
          const key = `${label}:${item.insertText}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        try {
          const advanced = await lsp.completionItems(position, context);
          return { suggestions: unique([...advanced, ...fallback]) };
        } catch {
          return { suggestions: fallback };
        }
      },
      resolveCompletionItem(item) {
        const client = (item as any).__hydroBatterLsp?.client as LspDocumentClient | undefined;
        return client?.resolveCompletionItem(item) || item;
      },
      triggerCharacters: ['.', ':', '>', '#', '<', '"', '/', '@'],
    }));
  } catch (error) {
    completionProviderLanguages.delete(monacoLanguage);
    throw error;
  }
  runtimeStatus.registeredLanguages = Array.from(completionProviderLanguages).sort();
}

function ensureSignatureProvider(
  monaco: typeof Monaco,
  monacoLanguage: string,
  catalogLanguage: string,
) {
  if (!config.completion || !catalogLanguage || signatureProviderLanguages.has(monacoLanguage)) return;
  signatureProviderLanguages.add(monacoLanguage);
  try {
    providerDisposables.push(monaco.languages.registerSignatureHelpProvider(monacoLanguage, {
      signatureHelpTriggerCharacters: ['(', ','],
      signatureHelpRetriggerCharacters: [','],
      async provideSignatureHelp(model, position, _token, context) {
        const language = catalogLanguageFor(model.getLanguageId()) || catalogLanguage;
        void prepareSyntaxModel(model, language).then(() => {
          runtimeStatus.syntaxEngine = getSyntaxEngineStatus();
        });
        const lsp = getLspClient(model);
        if (lsp) {
          try {
            const result = await lsp.signatureHelp(position, context);
            if (result) return result;
          } catch { /* Fall through to browser analysis. */ }
        }
        const signature = getIdeSignatureHelp(
          getCompletionAnalysis(model, language),
          model.getValue(),
          model.getOffsetAt(position),
        );
        if (!signature) return null;
        return {
          value: {
            activeSignature: 0,
            activeParameter: signature.activeParameter,
            signatures: signature.signatures,
          },
          dispose: () => undefined,
        };
      },
    }));
  } catch (error) {
    signatureProviderLanguages.delete(monacoLanguage);
    throw error;
  }
}

function ensureFormattingProvider(
  monaco: typeof Monaco,
  monacoLanguage: string,
  catalogLanguage: string,
) {
  const nativeFormattingLanguages = new Set(['javascript', 'typescript']);
  if (!config.formatting
    || !supportsFallbackFormatting(catalogLanguage)
    || nativeFormattingLanguages.has(catalogLanguage)
    || formattingProviderLanguages.has(monacoLanguage)) return;
  formattingProviderLanguages.add(monacoLanguage);
  providerDisposables.push(monaco.languages.registerDocumentFormattingEditProvider(monacoLanguage, {
    async provideDocumentFormattingEdits(model, options) {
      const lsp = getLspClient(model);
      if (lsp) {
        try {
          const edits = await lsp.formatting(options);
          if (edits.length) return edits;
        } catch { /* Fall through to conservative browser formatting. */ }
      }
      const formatted = formatCode(model.getValue(), catalogLanguage, options.tabSize);
      if (formatted === model.getValue()) return [];
      return [{ range: model.getFullModelRange(), text: formatted }];
    },
  }));
}

function ensureHoverProvider(monaco: typeof Monaco, monacoLanguage: string) {
  if (!config.lspEnabled
    || hoverProviderLanguages.has(monacoLanguage)
    || typeof monaco.languages.registerHoverProvider !== 'function') return;
  hoverProviderLanguages.add(monacoLanguage);
  providerDisposables.push(monaco.languages.registerHoverProvider(monacoLanguage, {
    async provideHover(model, position) {
      const lsp = getLspClient(model);
      if (!lsp) return null;
      try {
        return await lsp.hover(position);
      } catch {
        return null;
      }
    },
  }));
}

function ensureLanguageProviders(monaco: typeof Monaco, monacoLanguage: string, catalogLanguage?: string) {
  const language = catalogLanguage || catalogLanguageFor(monacoLanguage);
  if (!language) return;
  languageBindings.set(monacoLanguage, language);
  ensureCompletionProvider(monaco, monacoLanguage, language);
  ensureSignatureProvider(monaco, monacoLanguage, language);
  ensureFormattingProvider(monaco, monacoLanguage, language);
  ensureHoverProvider(monaco, monacoLanguage);
}

function registerProviders(monaco: typeof Monaco) {
  for (const [monacoLanguage, catalogLanguage] of collectLanguageBindings()) {
    languageBindings.set(monacoLanguage, catalogLanguage);
    ensureLanguageProviders(monaco, monacoLanguage, catalogLanguage);
  }
}

function getDraftContext(language: string): DraftContext {
  const ui = (window as any).UiContext || {};
  const user = (window as any).UserContext || {};
  const pdoc = ui.pdoc || {};
  const tdoc = ui.tdoc || {};
  const query = new URLSearchParams(window.location.search);
  return {
    userId: String(user._id || 'guest'),
    domainId: String(pdoc.domainId || document.documentElement.dataset.domainId || 'system'),
    problemId: String(pdoc.pid || pdoc.docId || window.location.pathname),
    contestId: String(tdoc.docId || query.get('tid') || 'normal'),
    language: catalogLanguageFor(language) || normalizeLanguage(language) || 'plaintext',
  };
}

function markerSeverity(monaco: typeof Monaco, severity: string): Monaco.MarkerSeverity {
  if (severity === 'error') return monaco.MarkerSeverity.Error;
  if (severity === 'warning') return monaco.MarkerSeverity.Warning;
  return monaco.MarkerSeverity.Info;
}

function updateModelText(
  editor: Monaco.editor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
  text: string,
  source: string,
) {
  const model = editor.getModel();
  if (!model) return;
  editor.pushUndoStop();
  editor.executeEdits(source, [{ range: model.getFullModelRange(), text }]);
  editor.pushUndoStop();
}

function insertTemplate(editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco, body: string) {
  const model = editor.getModel();
  if (!model) return;
  const selection = editor.getSelection() || new monaco.Selection(1, 1, 1, 1);
  const range = model.getValue().trim() ? selection : model.getFullModelRange();
  editor.pushUndoStop();
  editor.executeEdits('hydro-batter-template', [{ range, text: body }]);
  editor.pushUndoStop();
  const todo = model.findNextMatch('TODO', range.getStartPosition(), false, false, null, true);
  if (todo) editor.setSelection(todo.range);
  editor.focus();
}

function showTemplatePicker(editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) {
  const modelLanguage = editor.getModel()?.getLanguageId() || '';
  const language = catalogLanguageFor(modelLanguage) || modelLanguage;
  const templates = getTemplates(language);
  if (!templates.length) {
    Notification.info(i18n('No template is available for this language'));
    return;
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'hydro-batter-template-backdrop';
  backdrop.setAttribute('role', 'presentation');
  const dialog = document.createElement('div');
  dialog.className = 'hydro-batter-template-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', i18n('Choose a code template'));
  const title = document.createElement('h2');
  title.textContent = i18n('Choose a code template');
  dialog.appendChild(title);

  const close = () => {
    document.removeEventListener('keydown', onKeydown, true);
    backdrop.remove();
    editor.focus();
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };

  for (const template of templates) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hydro-batter-template-item';
    const name = document.createElement('strong');
    name.textContent = template.name;
    const description = document.createElement('span');
    description.textContent = template.description;
    button.append(name, description);
    button.addEventListener('click', () => {
      insertTemplate(editor, monaco, template.body);
      close();
    });
    dialog.appendChild(button);
  }

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'button hydro-batter-template-cancel';
  cancel.textContent = i18n('Cancel');
  cancel.addEventListener('click', close);
  dialog.appendChild(cancel);
  backdrop.appendChild(dialog);
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKeydown, true);
  document.body.appendChild(backdrop);
  (dialog.querySelector('button') as HTMLButtonElement | null)?.focus();
}

class EditorSession {
  private disposables: Monaco.IDisposable[] = [];
  private modelDisposables: Monaco.IDisposable[] = [];
  private autosaveTimer?: ReturnType<typeof setTimeout>;
  private diagnosticsTimer?: ReturnType<typeof setTimeout>;
  private restoreTimer?: ReturnType<typeof setTimeout>;
  private completionOptionsTimer?: ReturnType<typeof setTimeout>;
  private lspClient?: LspDocumentClient;
  private lastDiagnosticCount = 0;
  private statusNode = document.createElement('div');
  private statusWidget: Monaco.editor.IOverlayWidget;
  private disposed = false;

  constructor(
    private editor: Monaco.editor.IStandaloneCodeEditor,
    private monaco: typeof Monaco,
  ) {
    this.statusNode.className = 'hydro-batter-status';
    const widgetId = `hydro-batter-status-${Math.random().toString(36).slice(2)}`;
    this.statusWidget = {
      getId: () => widgetId,
      getDomNode: () => this.statusNode,
      getPosition: () => ({
        preference: monaco.editor.OverlayWidgetPositionPreference.BOTTOM_RIGHT_CORNER,
      }),
    };
    this.editor.addOverlayWidget(this.statusWidget);
    this.installCompletionKeyHandler();
    this.installActions();
    this.disposables.push(
      this.editor.onDidChangeModel(() => this.bindModel()),
      this.editor.onDidChangeConfiguration(() => this.scheduleCompletionOptions()),
      this.editor.onDidDispose(() => this.dispose()),
    );
    if (typeof this.monaco.editor.onDidChangeModelLanguage === 'function') {
      this.disposables.push(this.monaco.editor.onDidChangeModelLanguage((event) => {
        if (event.model === this.editor.getModel()) this.bindModel();
      }));
    }
    this.bindModel();
  }

  private installActions() {
    if (!(this.editor as any)._standaloneKeybindingService) {
      this.installFallbackActionKeyHandler();
      return;
    }
    if (config.templates) {
      this.disposables.push(this.editor.addAction({
        id: 'hydro-batter.insert-template',
        label: i18n('Batter editor: insert template'),
        keybindings: [this.monaco.KeyMod.CtrlCmd | this.monaco.KeyMod.Alt | this.monaco.KeyCode.KeyT],
        contextMenuGroupId: '1_modification',
        contextMenuOrder: 1,
        run: () => showTemplatePicker(this.editor, this.monaco),
      }));
    }
    if (config.formatting) {
      this.disposables.push(this.editor.addAction({
        id: 'hydro-batter.format-document',
        label: i18n('Batter editor: format document'),
        keybindings: [this.monaco.KeyMod.Shift | this.monaco.KeyMod.Alt | this.monaco.KeyCode.KeyF],
        contextMenuGroupId: '1_modification',
        contextMenuOrder: 2,
        run: () => this.formatDocument(),
      }));
    }
    if (config.autosave) {
      this.disposables.push(
        this.editor.addAction({
          id: 'hydro-batter.save-draft',
          label: i18n('Batter editor: save local draft'),
          keybindings: [this.monaco.KeyMod.CtrlCmd | this.monaco.KeyCode.KeyS],
          contextMenuGroupId: '9_cutcopypaste',
          contextMenuOrder: 3,
          run: () => {
            this.saveNow();
            Notification.info(i18n('Local draft saved'));
          },
        }),
        this.editor.addAction({
          id: 'hydro-batter.restore-draft',
          label: i18n('Batter editor: restore local draft'),
          contextMenuGroupId: '9_cutcopypaste',
          contextMenuOrder: 4,
          run: () => this.restoreDraft(true),
        }),
        this.editor.addAction({
          id: 'hydro-batter.clear-draft',
          label: i18n('Batter editor: clear local draft'),
          contextMenuGroupId: '9_cutcopypaste',
          contextMenuOrder: 5,
          run: () => {
            const model = this.editor.getModel();
            if (model) clearDraft(localStorage, getDraftContext(model.getLanguageId()));
            this.updateStatus();
            Notification.info(i18n('Local draft cleared'));
          },
        }),
      );
    }
  }

  private installFallbackActionKeyHandler() {
    const domNode = this.editor.getDomNode();
    if (!domNode) return;
    const onKeydown = (event: KeyboardEvent) => {
      if (!this.editor.hasTextFocus()) return;
      const primaryModifier = event.ctrlKey || event.metaKey;
      if (config.templates
        && primaryModifier
        && event.altKey
        && event.code === 'KeyT') {
        event.preventDefault();
        event.stopImmediatePropagation();
        showTemplatePicker(this.editor, this.monaco);
        return;
      }
      if (config.formatting
        && event.shiftKey
        && event.altKey
        && event.code === 'KeyF') {
        event.preventDefault();
        event.stopImmediatePropagation();
        void this.formatDocument();
        return;
      }
      if (config.autosave
        && primaryModifier
        && !event.altKey
        && !event.shiftKey
        && event.code === 'KeyS') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.saveNow();
        Notification.info(i18n('Local draft saved'));
      }
    };
    domNode.addEventListener('keydown', onKeydown, true);
    this.disposables.push({
      dispose: () => domNode.removeEventListener('keydown', onKeydown, true),
    });
  }

  private async formatDocument() {
    const action = this.editor.getAction('editor.action.formatDocument');
    if (action?.isSupported()) {
      await action.run();
      return;
    }
    const model = this.editor.getModel();
    if (model) updateModelText(
      this.editor,
      this.monaco,
      formatCode(
        model.getValue(),
        catalogLanguageFor(model.getLanguageId()) || model.getLanguageId(),
        model.getOptions().tabSize,
      ),
      'hydro-batter-format',
    );
  }

  private installCompletionKeyHandler() {
    if (!config.completion) return;
    const domNode = this.editor.getDomNode();
    if (!domNode) return;
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab'
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
        || event.isComposing
        || !this.editor.hasTextFocus()) return;
      if (domNode.querySelector('.suggest-widget.visible')) return;
      const snippetController = this.editor.getContribution('snippetController2') as any;
      if (snippetController?.isInSnippet?.()) return;
      if (!this.getUniqueCompletionExpansion()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.expandUniqueCompletion();
    };
    domNode.addEventListener('keydown', onKeydown, true);
    this.disposables.push({
      dispose: () => domNode.removeEventListener('keydown', onKeydown, true),
    });
  }

  private getUniqueCompletionExpansion() {
    if (!config.completion) return null;
    const model = this.editor.getModel();
    const position = this.editor.getPosition();
    if (!model || !position) return null;
    const language = catalogLanguageFor(model.getLanguageId());
    if (!language) return null;
    const word = model.getWordUntilPosition(position);
    const range = new this.monaco.Range(
      position.lineNumber,
      word.startColumn,
      position.lineNumber,
      word.endColumn,
    );
    const prefix = model.getValueInRange(range);
    const symbol = getUniqueCompletionSymbol(language, prefix);
    if (!symbol) return null;
    const edits: Monaco.editor.IIdentifiedSingleEditOperation[] = [{
      range,
      text: symbol.insertText || symbol.label,
    }];
    const autoImport = getAutoImportEdit(model.getValue(), language, symbol.label);
    if (autoImport) edits.push({
      range: completionRange(model, autoImport),
      text: autoImport.text,
    });
    return edits;
  }

  private expandUniqueCompletion() {
    const completion = this.getUniqueCompletionExpansion();
    if (!completion) return;
    this.editor.pushUndoStop();
    this.editor.executeEdits('hydro-batter-tab-completion', completion);
    this.editor.pushUndoStop();
    this.editor.focus();
  }

  private scheduleCompletionOptions() {
    if (!config.completion || this.disposed) return;
    clearTimeout(this.completionOptionsTimer);
    this.completionOptionsTimer = setTimeout(() => this.applyCompletionOptions());
  }

  private applyCompletionOptions() {
    if (!config.completion || this.disposed) return;
    const rawOptions = this.editor.getRawOptions();
    const quickSuggestions = rawOptions.quickSuggestions;
    const quickSuggestionsReady = quickSuggestions === true
      || (typeof quickSuggestions === 'object' && quickSuggestions?.other === true);
    if (rawOptions.acceptSuggestionOnEnter === 'on'
      && quickSuggestionsReady
      && (rawOptions.quickSuggestionsDelay ?? 10) <= 50
      && rawOptions.snippetSuggestions === 'top'
      && rawOptions.suggestOnTriggerCharacters !== false
      && rawOptions.tabCompletion === 'on') return;
    this.editor.updateOptions({
      acceptSuggestionOnEnter: 'on',
      quickSuggestions: { other: true, comments: false, strings: false },
      quickSuggestionsDelay: 0,
      snippetSuggestions: 'top',
      suggestOnTriggerCharacters: true,
      tabCompletion: 'on',
    });
  }

  private bindModel() {
    this.lspClient?.dispose();
    this.lspClient = undefined;
    this.modelDisposables.forEach((item) => item.dispose());
    this.modelDisposables = [];
    clearTimeout(this.autosaveTimer);
    clearTimeout(this.diagnosticsTimer);
    clearTimeout(this.restoreTimer);
    clearTimeout(this.completionOptionsTimer);
    const model = this.editor.getModel();
    if (!model) return;
    const language = catalogLanguageFor(model.getLanguageId());
    if (!getSupportedLanguages().includes(language) && !supportsFallbackFormatting(language)) {
      this.statusNode.style.display = 'none';
      return;
    }
    ensureLanguageProviders(this.monaco, model.getLanguageId(), language);
    void prepareSyntaxModel(model, language).then(() => {
      runtimeStatus.syntaxEngine = getSyntaxEngineStatus();
      this.updateStatus();
    });
    this.lspClient = prepareLspModel(model, language, this.monaco, () => {
      runtimeStatus.lspEngine = getLspEngineStatus();
      this.updateStatus();
    });
    runtimeStatus.lspEngine = getLspEngineStatus();
    this.statusNode.style.display = '';
    this.applyCompletionOptions();
    this.modelDisposables.push(model.onDidChangeContent(() => {
      this.scheduleAutosave();
      this.scheduleDiagnostics();
    }));
    this.runDiagnostics();
    this.updateStatus();
    // Monaco's creation event fires before Scratchpad registers its Redux change listener.
    // Restore on the next task so Scratchpad receives the edit.
    this.restoreTimer = setTimeout(() => {
      if (!this.disposed && this.editor.getModel() === model) this.restoreDraft(false);
    });
  }

  private scheduleAutosave() {
    if (!config.autosave) return;
    clearTimeout(this.autosaveTimer);
    const diagnosticCount = this.lastDiagnosticCount + (this.lspClient?.diagnosticCount || 0);
    this.statusNode.textContent = diagnosticCount
      ? i18n('{0} diagnostics', diagnosticCount)
      : '●';
    this.autosaveTimer = setTimeout(() => this.saveNow(), config.autosaveDelay);
  }

  private scheduleDiagnostics() {
    if (!config.diagnostics) return;
    clearTimeout(this.diagnosticsTimer);
    this.diagnosticsTimer = setTimeout(() => this.runDiagnostics(), config.diagnosticsDelay);
  }

  private runDiagnostics() {
    const model = this.editor.getModel();
    if (!model || !config.diagnostics) return;
    const diagnostics = diagnoseCode(
      model.getValue(),
      catalogLanguageFor(model.getLanguageId()) || model.getLanguageId(),
    );
    this.lastDiagnosticCount = diagnostics.length;
    this.monaco.editor.setModelMarkers(model, MARKER_OWNER, diagnostics.map((item) => ({
      severity: markerSeverity(this.monaco, item.severity),
      message: item.message,
      source: 'Batter',
      code: item.code,
      startLineNumber: item.line,
      startColumn: item.column,
      endLineNumber: item.endLine,
      endColumn: item.endColumn,
    })));
    this.updateStatus();
  }

  private restoreDraft(force: boolean) {
    if (!config.autosave) return;
    const model = this.editor.getModel();
    if (!model) return;
    const draft = readDraft(localStorage, getDraftContext(model.getLanguageId()));
    if (!draft || !draft.code) {
      if (force) Notification.info(i18n('No local draft was found'));
      return;
    }
    if (!force && model.getValue().trim()) return;
    if (draft.code === model.getValue()) return;
    updateModelText(this.editor, this.monaco, draft.code, 'hydro-batter-restore');
    Notification.info(i18n('Local draft restored'));
  }

  saveNow() {
    if (!config.autosave || this.disposed) return;
    try {
      const model = this.editor.getModel();
      if (!model || model.isDisposed() || !model.getValue().trim()) return;
      writeDraft(
        localStorage,
        getDraftContext(model.getLanguageId()),
        model.getValue(this.monaco.editor.EndOfLinePreference.LF, false),
        window.location.href,
      );
      this.updateStatus();
    } catch (error) {
      console.warn('Hydro Batter Code Edit could not save the local draft.', error);
    }
  }

  private updateStatus() {
    const model = this.editor.getModel();
    if (!model) return;
    const parts: string[] = [`Batter ${PLUGIN_VERSION}`];
    if (config.completion && catalogLanguageFor(model.getLanguageId())) {
      parts.push(i18n('Completion ready'));
      if (runtimeStatus.syntaxEngine.readyLanguages.includes(catalogLanguageFor(model.getLanguageId()))) {
        parts.push(i18n('Syntax analysis ready'));
      }
      if (this.lspClient?.state === 'ready') parts.push(i18n('Language server ready'));
    }
    if (config.autosave) {
      const draft = readDraft(localStorage, getDraftContext(model.getLanguageId()));
      if (draft) parts.push(i18n('Draft saved at {0}', new Date(draft.updatedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })));
    }
    const diagnosticCount = this.lastDiagnosticCount + (this.lspClient?.diagnosticCount || 0);
    if (diagnosticCount) parts.push(i18n('{0} diagnostics', diagnosticCount));
    this.statusNode.textContent = parts.join(' · ');
    this.statusNode.dataset.level = diagnosticCount ? 'warning' : 'normal';
  }

  dispose() {
    if (this.disposed) return;
    this.saveNow();
    this.disposed = true;
    clearTimeout(this.autosaveTimer);
    clearTimeout(this.diagnosticsTimer);
    clearTimeout(this.restoreTimer);
    clearTimeout(this.completionOptionsTimer);
    this.lspClient?.dispose();
    this.lspClient = undefined;
    try {
      const model = this.editor.getModel();
      if (model && !model.isDisposed()) this.monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
    } catch { /* Editor may already be disposed. */ }
    this.modelDisposables.forEach((item) => item.dispose());
    this.disposables.forEach((item) => item.dispose());
    try {
      this.editor.removeOverlayWidget(this.statusWidget);
    } catch { /* Editor may already be disposed. */ }
    sessions.delete(this);
    attachedEditors.delete(this.editor);
    runtimeStatus.editorCount = sessions.size;
  }
}

function attachEditor(editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) {
  if (attachedEditors.has(editor)) return;
  const session = new EditorSession(editor, monaco);
  attachedEditors.set(editor, session);
  sessions.add(session);
  runtimeStatus.editorCount = sessions.size;
}

addPage(new AutoloadPage('hydro-batter-code-edit', async (pageName) => {
  runtimeStatus.pageName = pageName;
  config = getConfig();
  runtimeStatus.completionEnabled = config.completion;
  if (!config.enabled) return;
  installStyles();
  try {
    cleanupExpiredDrafts(localStorage, config.draftRetentionDays);
  } catch (error) {
    console.warn('Hydro Batter Code Edit could not clean local drafts.', error);
  }

  try {
    const loaded = await loadMonaco([]);
    monacoApi = loaded.monaco;
    registerProviders(monacoApi);
    providerDisposables.push(monacoApi.editor.onDidCreateEditor((editor) => attachEditor(
      editor as Monaco.editor.IStandaloneCodeEditor,
      monacoApi,
    )));
    monacoApi.editor.getEditors().forEach((editor) => attachEditor(
      editor as Monaco.editor.IStandaloneCodeEditor,
      monacoApi,
    ));

    runtimeStatus.loaded = true;
    console.info(
      `[Hydro Batter Code Edit ${PLUGIN_VERSION}] loaded; completion providers:`,
      runtimeStatus.registeredLanguages.join(', '),
    );
    window.addEventListener('beforeunload', () => {
      sessions.forEach((session) => session.saveNow());
    }, { once: true });
  } catch (error) {
    runtimeStatus.error = error instanceof Error ? error.message : String(error);
    console.error(`[Hydro Batter Code Edit ${PLUGIN_VERSION}] initialization failed.`, error);
  }
}));
