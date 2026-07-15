import {
  $, addPage, i18n, loadMonaco, NamedPage, Notification,
} from '@hydrooj/ui-default';
import type * as Monaco from 'monaco-editor';
import { getCompletionSnippets, getSupportedLanguages, getTemplates, normalizeLanguage } from '../src/catalog';
import { diagnoseCode } from '../src/diagnostics';
import {
  buildDraftKey, cleanupExpiredDrafts, clearDraft, DraftContext, readDraft, writeDraft,
} from '../src/drafts';
import { formatCode, supportsFallbackFormatting } from '../src/formatter';
import { BatterEditorConfig, DEFAULT_EDITOR_CONFIG } from '../types';

const PAGE_NAMES = [
  'problem_detail',
  'contest_detail_problem',
  'homework_detail_problem',
  'problem_submit',
  'contest_detail_problem_submit',
  'homework_detail_problem_submit',
];
const SUBMIT_PAGE_NAMES = new Set([
  'problem_submit',
  'contest_detail_problem_submit',
  'homework_detail_problem_submit',
]);
const MARKER_OWNER = 'hydro-batter-code-edit';
const sessions = new Set<EditorSession>();
const attachedEditors = new WeakMap<Monaco.editor.IStandaloneCodeEditor, EditorSession>();

let monacoApi: typeof Monaco;
let config: BatterEditorConfig;
let providerDisposables: Monaco.IDisposable[] = [];

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
    .hydro-batter-editor { width: 100%; border: 1px solid #d5d5d5; border-radius: 3px; overflow: hidden; }
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

function registerProviders(monaco: typeof Monaco) {
  if (providerDisposables.length) return;
  const completionLanguages = getSupportedLanguages();
  if (config.completion) {
    for (const language of completionLanguages) {
      providerDisposables.push(monaco.languages.registerCompletionItemProvider(language, {
        provideCompletionItems(model, position) {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          return {
            suggestions: getCompletionSnippets(language).map((snippet, index) => ({
              label: snippet.label,
              detail: snippet.detail,
              documentation: snippet.detail,
              filterText: `${snippet.prefix} ${snippet.label}`,
              insertText: snippet.body,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              kind: index === 0
                ? monaco.languages.CompletionItemKind.Module
                : monaco.languages.CompletionItemKind.Snippet,
              range,
              sortText: `0${index.toString().padStart(2, '0')}`,
            })),
          };
        },
      }));
    }
  }

  if (config.formatting) {
    const nativeFormattingLanguages = new Set(['javascript', 'typescript']);
    const formattingLanguages = new Set([
      ...completionLanguages,
      'typescript', 'ruby', 'shell', 'bash', 'haskell', 'r',
    ]);
    for (const language of formattingLanguages) {
      if (!supportsFallbackFormatting(language) || nativeFormattingLanguages.has(language)) continue;
      providerDisposables.push(monaco.languages.registerDocumentFormattingEditProvider(language, {
        provideDocumentFormattingEdits(model, options) {
          const formatted = formatCode(model.getValue(), language, options.tabSize);
          if (formatted === model.getValue()) return [];
          return [{ range: model.getFullModelRange(), text: formatted }];
        },
      }));
    }
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
    language: normalizeLanguage(language) || 'plaintext',
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
  const language = editor.getModel()?.getLanguageId() || '';
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
    this.installActions();
    this.disposables.push(
      this.editor.onDidChangeModel(() => this.bindModel()),
      this.editor.onDidDispose(() => this.dispose()),
    );
    this.bindModel();
  }

  private installActions() {
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
        run: async () => {
          const action = this.editor.getAction('editor.action.formatDocument');
          if (action?.isSupported()) await action.run();
          else {
            const model = this.editor.getModel();
            if (model) updateModelText(
              this.editor,
              this.monaco,
              formatCode(model.getValue(), model.getLanguageId(), model.getOptions().tabSize),
              'hydro-batter-format',
            );
          }
        },
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

  private bindModel() {
    this.modelDisposables.forEach((item) => item.dispose());
    this.modelDisposables = [];
    clearTimeout(this.autosaveTimer);
    clearTimeout(this.diagnosticsTimer);
    clearTimeout(this.restoreTimer);
    const model = this.editor.getModel();
    if (!model) return;
    const language = normalizeLanguage(model.getLanguageId());
    if (!getSupportedLanguages().includes(language) && !supportsFallbackFormatting(language)) {
      this.statusNode.style.display = 'none';
      return;
    }
    this.statusNode.style.display = '';
    this.modelDisposables.push(model.onDidChangeContent(() => {
      this.scheduleAutosave();
      this.scheduleDiagnostics();
    }));
    this.runDiagnostics();
    this.updateStatus();
    // Monaco's creation event fires before Scratchpad registers its Redux change listener.
    // Restore on the next task so both Scratchpad and the submission textarea receive the edit.
    this.restoreTimer = setTimeout(() => {
      if (!this.disposed && this.editor.getModel() === model) this.restoreDraft(false);
    });
  }

  private scheduleAutosave() {
    if (!config.autosave) return;
    clearTimeout(this.autosaveTimer);
    this.statusNode.textContent = this.lastDiagnosticCount
      ? i18n('{0} diagnostics', this.lastDiagnosticCount)
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
    const diagnostics = diagnoseCode(model.getValue(), model.getLanguageId());
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
    const parts: string[] = [];
    if (config.autosave) {
      const draft = readDraft(localStorage, getDraftContext(model.getLanguageId()));
      if (draft) parts.push(i18n('Draft saved at {0}', new Date(draft.updatedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })));
    }
    if (this.lastDiagnosticCount) parts.push(i18n('{0} diagnostics', this.lastDiagnosticCount));
    this.statusNode.textContent = parts.join(' · ') || 'Batter';
    this.statusNode.dataset.level = this.lastDiagnosticCount ? 'warning' : 'normal';
  }

  dispose() {
    if (this.disposed) return;
    this.saveNow();
    this.disposed = true;
    clearTimeout(this.autosaveTimer);
    clearTimeout(this.diagnosticsTimer);
    clearTimeout(this.restoreTimer);
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
  }
}

function attachEditor(editor: Monaco.editor.IStandaloneCodeEditor, monaco: typeof Monaco) {
  if (attachedEditors.has(editor)) return;
  const session = new EditorSession(editor, monaco);
  attachedEditors.set(editor, session);
  sessions.add(session);
}

function getSelectedLanguage(): string {
  const languageKey = String(($('[name="lang"]') as any).val?.() || '');
  const langConfig = (window as any).LANGS?.[languageKey];
  return normalizeLanguage(langConfig?.monaco || langConfig?.highlight || languageKey || 'plaintext');
}

async function createSubmissionEditor(monaco: typeof Monaco, registerAction: Function, customOptions: object) {
  const textarea = document.querySelector<HTMLTextAreaElement>('textarea[name="code"]');
  if (!textarea || textarea.dataset.hydroBatterEditor) return;
  textarea.dataset.hydroBatterEditor = 'true';
  const language = getSelectedLanguage();
  const container = document.createElement('div');
  container.className = 'hydro-batter-editor textbox';
  container.style.height = `${config.editorHeight}px`;
  textarea.hidden = true;
  textarea.insertAdjacentElement('afterend', container);

  const uri = monaco.Uri.parse(`hydro-batter://submission/${encodeURIComponent(buildDraftKey(getDraftContext(language)))}`);
  const model = monaco.editor.createModel(textarea.value || '', language, uri);
  const editor = monaco.editor.create(container, {
    ...customOptions,
    model,
    automaticLayout: true,
    lineNumbers: 'on',
    glyphMargin: true,
    minimap: { enabled: false },
    lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.On },
    fontFamily: (window as any).UserContext?.codeFontFamily,
    fontLigatures: '',
    scrollBeyondLastLine: false,
  });
  registerAction(editor, model, textarea);
  textarea.value = model.getValue();
  const syncTextarea = () => {
    textarea.value = model.getValue(monaco.editor.EndOfLinePreference.LF, false);
    textarea.textContent = textarea.value;
  };
  const modelDisposable = model.onDidChangeContent(syncTextarea);
  const form = textarea.closest('form');
  form?.addEventListener('submit', syncTextarea);

  const updateLanguage = () => {
    const nextLanguage = getSelectedLanguage();
    if (nextLanguage && model.getLanguageId() !== nextLanguage) monaco.editor.setModelLanguage(model, nextLanguage);
  };
  const selector = document.getElementById('codelang-selector');
  selector?.addEventListener('change', () => setTimeout(updateLanguage));
  selector?.addEventListener('click', () => setTimeout(updateLanguage));

  editor.onDidDispose(() => {
    modelDisposable.dispose();
    if (!model.isDisposed()) model.dispose();
    container.remove();
    textarea.hidden = false;
  });
  (window as any).editor = editor;
  (window as any).model = model;
  editor.focus();
}

addPage(new NamedPage(PAGE_NAMES, async (pageName) => {
  config = getConfig();
  if (!config.enabled) return;
  installStyles();
  try {
    cleanupExpiredDrafts(localStorage, config.draftRetentionDays);
  } catch (error) {
    console.warn('Hydro Batter Code Edit could not clean local drafts.', error);
  }

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

  if (SUBMIT_PAGE_NAMES.has(pageName)) {
    await new Promise((resolve) => setTimeout(resolve, 80));
    await createSubmissionEditor(monacoApi, loaded.registerAction, loaded.customOptions || {});
  }

  window.addEventListener('beforeunload', () => {
    sessions.forEach((session) => session.saveNow());
  }, { once: true });
}));
