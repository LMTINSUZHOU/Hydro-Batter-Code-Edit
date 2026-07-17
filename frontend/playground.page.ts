import {
  addPage, i18n, loadMonaco, NamedPage, Notification,
} from '@hydrooj/ui-default';
import type * as Monaco from 'monaco-editor';
import { getTemplates } from '../src/catalog';
import type { PlaygroundFamily, PlaygroundLanguage, PlaygroundRunResult } from '../src/playground';
import './playground.css';

const STORAGE_KEY = 'hydro-batter-code-edit:playground:v1';

interface CursorState {
  line: number;
  column: number;
  scrollTop: number;
  scrollLeft: number;
}

interface ClosedState {
  version: 1;
  languageKey: string;
  code: Partial<Record<PlaygroundFamily, string>>;
  cursor: Partial<Record<PlaygroundFamily, CursorState>>;
  input: string;
  output: string;
  outputStatus: string;
  outputState: string;
  runMeta: string;
  closedAt: number;
}

interface PlaygroundConfig {
  endpoint: string;
  languages: PlaygroundLanguage[];
  timeLimitSeconds: number;
  memoryLimitMb: number;
  maxInputBytes: number;
}

function readClosedState(storageKey: string, languages: PlaygroundLanguage[]): ClosedState | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const state = JSON.parse(raw) as Partial<ClosedState>;
    if (state.version !== 1 || !state.code || typeof state.input !== 'string') return null;
    if (!languages.some((language) => language.key === state.languageKey)) state.languageKey = languages[0]?.key;
    return state as ClosedState;
  } catch {
    return null;
  }
}

function byteSize(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KiB`;
}

function templateFor(family: PlaygroundFamily): string {
  return getTemplates(family)[0]?.body || '';
}

function filename(language: PlaygroundLanguage): string {
  if (language.family === 'java') return 'Main.java';
  if (language.family === 'python') return 'main.py';
  return `main.${language.extension}`;
}

function errorMessage(payload: any, fallback: string): string {
  if (typeof payload?.error === 'string') return payload.error;
  if (typeof payload?.error?.message === 'string') return payload.error.message;
  return fallback;
}

function renderResult(result: PlaygroundRunResult): string {
  const sections: string[] = [];
  if (result.compilerText) sections.push(`${i18n('Compiler output')}\n${result.compilerText}`);
  if (result.output) sections.push(result.output);
  if (result.judgeText && !result.output) sections.push(result.judgeText);
  return sections.join('\n\n') || i18n('The program finished without output.');
}

addPage(new NamedPage('hydro_batter_playground', async () => {
  const root = document.getElementById('hydro-batter-playground');
  const editorNode = document.getElementById('hydro-batter-playground-editor');
  if (!root || !editorNode) return;

  const config = (window as any).UiContext?.hydroBatterPlayground as PlaygroundConfig | undefined;
  const languages = Array.isArray(config?.languages) ? config.languages : [];
  if (!config || !languages.length) return;

  const userId = String((window as any).UserContext?._id || 'guest');
  const domainId = String((window as any).UiContext?.domainId || 'system');
  const storageKey = `${STORAGE_KEY}:${encodeURIComponent(userId)}:${encodeURIComponent(domainId)}`;

  const languageSelect = document.getElementById('hydro-batter-playground-language') as HTMLSelectElement;
  const input = document.getElementById('hydro-batter-playground-input') as HTMLTextAreaElement;
  const output = document.getElementById('hydro-batter-playground-output') as HTMLElement;
  const runButton = document.getElementById('hydro-batter-playground-run') as HTMLButtonElement;
  const runLabel = runButton.querySelector('[data-run-label]') as HTMLElement;
  const templateButton = document.getElementById('hydro-batter-playground-template') as HTMLButtonElement;
  const formatButton = document.getElementById('hydro-batter-playground-format') as HTMLButtonElement;
  const fileLabel = root.querySelector('[data-file-name]') as HTMLElement;
  const inputSize = root.querySelector('[data-input-size]') as HTMLElement;
  const outputStatus = root.querySelector('[data-output-status]') as HTMLElement;
  const runMeta = root.querySelector('[data-run-meta]') as HTMLElement;
  const closed = readClosedState(storageKey, languages);
  const loaded = await loadMonaco([]);
  const monaco = loaded.monaco as typeof Monaco;
  const models = new Map<PlaygroundFamily, Monaco.editor.ITextModel>();
  const cursor: Partial<Record<PlaygroundFamily, CursorState>> = { ...(closed?.cursor || {}) };
  let activeLanguage = languages.find((item) => item.key === closed?.languageKey) || languages[0];
  let running = false;

  const createModel = (language: PlaygroundLanguage) => {
    const existing = models.get(language.family);
    if (existing) return existing;
    const code = closed?.code?.[language.family] || templateFor(language.family);
    const uri = monaco.Uri.parse(`hydro-batter-playground://local/${filename(language)}`);
    const model = monaco.editor.createModel(code, language.monaco, uri);
    models.set(language.family, model);
    return model;
  };

  languageSelect.value = activeLanguage.key;
  input.value = closed?.input || '';
  if (closed) {
    output.textContent = closed.output || '';
    outputStatus.textContent = closed.outputStatus || i18n('Ready to run');
    outputStatus.dataset.state = closed.outputState || 'idle';
    runMeta.textContent = closed.runMeta || '';
  }
  inputSize.textContent = formatBytes(byteSize(input.value));
  fileLabel.textContent = filename(activeLanguage);

  const editor = monaco.editor.create(editorNode, {
    ...(loaded.customOptions || {}),
    model: createModel(activeLanguage),
    theme: Array.from(document.documentElement.classList).some((name) => name.startsWith('theme--dark'))
      ? 'vs-dark' : 'vs-light',
    automaticLayout: true,
    fontFamily: (window as any).UserContext?.codeFontFamily,
    fontLigatures: '',
    fontSize: 14,
    lineHeight: 22,
    lineNumbers: 'on',
    glyphMargin: true,
    folding: true,
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
    minimap: { enabled: window.innerWidth >= 1180 },
    padding: { top: 12, bottom: 12 },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    formatOnPaste: true,
    formatOnType: true,
    suggest: { preview: true, showStatusBar: true },
    quickSuggestions: { other: true, comments: false, strings: false },
    quickSuggestionsDelay: 0,
    tabCompletion: 'on',
  });

  const restoreCursor = (family: PlaygroundFamily) => {
    const state = cursor[family];
    if (!state) return;
    editor.setPosition({ lineNumber: state.line, column: state.column });
    editor.setScrollTop(state.scrollTop);
    editor.setScrollLeft(state.scrollLeft);
  };
  const captureCursor = () => {
    const position = editor.getPosition();
    if (!position) return;
    cursor[activeLanguage.family] = {
      line: position.lineNumber,
      column: position.column,
      scrollTop: editor.getScrollTop(),
      scrollLeft: editor.getScrollLeft(),
    };
  };
  restoreCursor(activeLanguage.family);

  const saveClosedState = () => {
    try {
      captureCursor();
      const code: Partial<Record<PlaygroundFamily, string>> = { ...(closed?.code || {}) };
      models.forEach((model, family) => { code[family] = model.getValue(); });
      const state: ClosedState = {
        version: 1,
        languageKey: activeLanguage.key,
        code,
        cursor,
        input: input.value,
        output: output.textContent || '',
        outputStatus: outputStatus.textContent || '',
        outputState: outputStatus.dataset.state || 'idle',
        runMeta: runMeta.textContent || '',
        closedAt: Date.now(),
      };
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch (error) {
      console.warn('Hydro Batter playground could not keep the last closed state.', error);
    }
  };
  window.addEventListener('pagehide', saveClosedState);
  window.addEventListener('beforeunload', saveClosedState);

  input.addEventListener('input', () => {
    inputSize.textContent = formatBytes(byteSize(input.value));
    inputSize.dataset.overLimit = byteSize(input.value) > config.maxInputBytes ? 'true' : 'false';
  });

  languageSelect.addEventListener('change', () => {
    const next = languages.find((item) => item.key === languageSelect.value);
    if (!next || next.key === activeLanguage.key) return;
    captureCursor();
    activeLanguage = next;
    editor.setModel(createModel(activeLanguage));
    fileLabel.textContent = filename(activeLanguage);
    restoreCursor(activeLanguage.family);
    editor.focus();
  });

  templateButton.addEventListener('click', () => {
    const model = editor.getModel();
    const next = templateFor(activeLanguage.family);
    if (!model || model.getValue() === next) return;
    if (model.getValue().trim() && !window.confirm(i18n('Replace the current code with the default template?'))) return;
    editor.pushUndoStop();
    editor.executeEdits('hydro-batter-playground-template', [{ range: model.getFullModelRange(), text: next }]);
    editor.pushUndoStop();
    editor.focus();
  });

  formatButton.addEventListener('click', async () => {
    const action = editor.getAction('editor.action.formatDocument');
    if (action?.isSupported()) await action.run();
    else Notification.info(i18n('No formatter is available for this language.'));
    editor.focus();
  });

  const run = async () => {
    if (running) return;
    const code = editor.getValue({ lineEnding: '\n', preserveBOM: false });
    const inputBytes = byteSize(input.value);
    if (!code.trim()) {
      Notification.warn(i18n('Enter some code before running.'));
      editor.focus();
      return;
    }
    if (inputBytes > config.maxInputBytes) {
      Notification.warn(i18n('Standard input is too large.'));
      input.focus();
      return;
    }
    running = true;
    runButton.disabled = true;
    languageSelect.disabled = true;
    runLabel.textContent = i18n('Running…');
    outputStatus.textContent = i18n('Queued for HydroJudge');
    outputStatus.dataset.state = 'running';
    output.textContent = i18n('Compiling and running in the isolated judge sandbox…');
    runMeta.textContent = '';
    const started = performance.now();
    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang: activeLanguage.key, code, stdin: input.value }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(errorMessage(payload, i18n('Program execution failed.')));
      const result = payload.result as PlaygroundRunResult;
      output.textContent = renderResult(result);
      outputStatus.textContent = i18n(result.statusText);
      outputStatus.dataset.state = result.status === 1 ? 'success' : 'error';
      const memory = result.memory >= 1024 ? `${(result.memory / 1024).toFixed(1)} MiB` : `${result.memory} KiB`;
      runMeta.textContent = `${result.time} ms · ${memory}`;
    } catch (error) {
      outputStatus.textContent = i18n('Run failed');
      outputStatus.dataset.state = 'error';
      output.textContent = error instanceof Error ? error.message : i18n('Program execution failed.');
      runMeta.textContent = `${Math.round(performance.now() - started)} ms`;
    } finally {
      running = false;
      runButton.disabled = false;
      languageSelect.disabled = false;
      runLabel.textContent = i18n('Run code');
    }
  };

  runButton.addEventListener('click', () => { void run(); });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    void run();
  });
  editor.focus();
}));
