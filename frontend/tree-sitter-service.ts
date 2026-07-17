import type * as Monaco from 'monaco-editor';
import {
  Edit, Language, Parser, Point, Tree,
} from 'web-tree-sitter';
import { normalizeLanguage } from '../src/catalog';
import { extractSyntaxFacts, SyntaxFacts } from '../src/syntax-facts';

const ASSET_BASE = '/hydro-batter-code-edit/wasm';
const LANGUAGE_ASSETS: Record<string, string> = {
  cpp: 'tree-sitter-cpp.wasm',
  python: 'tree-sitter-python.wasm',
  java: 'tree-sitter-java.wasm',
};

const languagePromises = new Map<string, Promise<Language>>();
const documents = new WeakMap<Monaco.editor.ITextModel, IncrementalSyntaxDocument>();
const readyLanguages = new Set<string>();
const failedLanguages = new Map<string, string>();
let corePromise: Promise<void> | undefined;

function assetUrl(name: string): string {
  return `${ASSET_BASE}/${name}`;
}

function initializeCore(): Promise<void> {
  if (!corePromise) {
    corePromise = Parser.init({ locateFile: () => assetUrl('web-tree-sitter.wasm') });
  }
  return corePromise;
}

async function loadLanguage(language: string): Promise<Language> {
  const normalized = normalizeLanguage(language);
  const asset = LANGUAGE_ASSETS[normalized];
  if (!asset) throw new Error(`Tree-sitter is not configured for ${normalized}`);
  let promise = languagePromises.get(normalized);
  if (!promise) {
    promise = initializeCore().then(() => Language.load(assetUrl(asset)));
    languagePromises.set(normalized, promise);
  }
  return promise;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function pointAt(code: string, offset: number): { index: number; point: Point } {
  const safeOffset = Math.max(0, Math.min(offset, code.length));
  const before = code.slice(0, safeOffset);
  const lineStart = before.lastIndexOf('\n') + 1;
  return {
    index: utf8Length(before),
    point: {
      row: before.split('\n').length - 1,
      column: utf8Length(before.slice(lineStart)),
    },
  };
}

function newEndPoint(start: Point, insertedText: string): Point {
  const lines = insertedText.split('\n');
  if (lines.length === 1) return { row: start.row, column: start.column + utf8Length(insertedText) };
  return { row: start.row + lines.length - 1, column: utf8Length(lines.at(-1) || '') };
}

export interface IncrementalTextChange {
  rangeOffset: number;
  rangeLength: number;
  text: string;
}

export function applyIncrementalTreeEdits(
  tree: Tree,
  code: string,
  rawChanges: readonly IncrementalTextChange[],
): string | undefined {
  let workingCode = code;
  const changes = [...rawChanges].sort((left, right) => right.rangeOffset - left.rangeOffset);
  for (const change of changes) {
    if (change.rangeOffset < 0 || change.rangeOffset + change.rangeLength > workingCode.length) return undefined;
    const start = pointAt(workingCode, change.rangeOffset);
    const oldEnd = pointAt(workingCode, change.rangeOffset + change.rangeLength);
    const insertedBytes = utf8Length(change.text);
    tree.edit(new Edit({
      startIndex: start.index,
      oldEndIndex: oldEnd.index,
      newEndIndex: start.index + insertedBytes,
      startPosition: start.point,
      oldEndPosition: oldEnd.point,
      newEndPosition: newEndPoint(start.point, change.text),
    }));
    workingCode = `${workingCode.slice(0, change.rangeOffset)}${change.text}${workingCode.slice(change.rangeOffset + change.rangeLength)}`;
  }
  return workingCode;
}

class IncrementalSyntaxDocument {
  readonly language: string;
  private parser?: Parser;
  private tree?: Tree;
  private code: string;
  private facts?: SyntaxFacts;
  private disposed = false;
  private readyPromise: Promise<void>;
  private disposables: Monaco.IDisposable[];

  constructor(private model: Monaco.editor.ITextModel, language: string) {
    this.language = normalizeLanguage(language);
    this.code = model.getValue();
    this.disposables = [
      model.onDidChangeContent((event) => this.handleChange(event)),
      model.onWillDispose(() => this.dispose()),
    ];
    this.readyPromise = this.initialize();
  }

  private async initialize() {
    try {
      const language = await loadLanguage(this.language);
      if (this.disposed || this.model.isDisposed()) return;
      this.parser = new Parser();
      this.parser.setLanguage(language);
      this.code = this.model.getValue();
      this.tree = this.parser.parse(this.code) || undefined;
      if (this.tree) this.facts = extractSyntaxFacts(this.tree, this.code, this.language);
      readyLanguages.add(this.language);
      failedLanguages.delete(this.language);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedLanguages.set(this.language, message);
      console.warn(`Hydro Batter Code Edit could not initialize Tree-sitter for ${this.language}; using fallback analysis.`, error);
    }
  }

  private handleChange(event: Monaco.editor.IModelContentChangedEvent) {
    if (this.disposed) return;
    const nextCode = this.model.getValue();
    if (!this.parser || !this.tree) {
      this.code = nextCode;
      return;
    }
    const workingCode = applyIncrementalTreeEdits(this.tree, this.code, event.changes);
    if (workingCode !== nextCode) {
      this.reparse(nextCode);
      return;
    }
    const oldTree = this.tree;
    const nextTree = this.parser.parse(nextCode, oldTree) || undefined;
    this.tree = nextTree;
    this.code = nextCode;
    if (nextTree) this.facts = extractSyntaxFacts(nextTree, nextCode, this.language);
    oldTree.delete();
  }

  private reparse(code: string) {
    this.tree?.delete();
    this.tree = this.parser?.parse(code) || undefined;
    this.code = code;
    this.facts = this.tree ? extractSyntaxFacts(this.tree, code, this.language) : undefined;
  }

  async prepare() {
    await this.readyPromise;
  }

  getFacts(): SyntaxFacts | undefined {
    return this.facts;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.disposables.forEach((disposable) => disposable.dispose());
    this.tree?.delete();
    this.parser?.delete();
    this.tree = undefined;
    this.parser = undefined;
    this.facts = undefined;
  }
}

function getDocument(model: Monaco.editor.ITextModel, language: string): IncrementalSyntaxDocument | undefined {
  if (typeof process !== 'undefined' && process.versions?.node) return undefined;
  const normalized = normalizeLanguage(language);
  if (!LANGUAGE_ASSETS[normalized]) return undefined;
  const existing = documents.get(model);
  if (existing?.language === normalized) return existing;
  existing?.dispose();
  const document = new IncrementalSyntaxDocument(model, normalized);
  documents.set(model, document);
  return document;
}

export function prepareSyntaxModel(model: Monaco.editor.ITextModel, language: string): Promise<void> {
  return getDocument(model, language)?.prepare() || Promise.resolve();
}

export function getReadySyntaxFacts(model: Monaco.editor.ITextModel, language: string): SyntaxFacts | undefined {
  return getDocument(model, language)?.getFacts();
}

export function getSyntaxEngineStatus() {
  return {
    readyLanguages: Array.from(readyLanguages).sort(),
    failures: Object.fromEntries(failedLanguages),
  };
}
