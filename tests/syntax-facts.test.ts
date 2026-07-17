import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    Language, Parser, Tree,
} from 'web-tree-sitter';
import { analyzeCompletionDocument, getIdeCompletionResult } from '../src/completion-engine';
import { extractSyntaxFacts } from '../src/syntax-facts';
import { applyIncrementalTreeEdits } from '../frontend/tree-sitter-service';

const GRAMMARS = {
    cpp: 'node_modules/tree-sitter-cpp/tree-sitter-cpp.wasm',
    python: 'node_modules/tree-sitter-python/tree-sitter-python.wasm',
    java: 'node_modules/tree-sitter-java/tree-sitter-java.wasm',
};

const languages = new Map<string, Language>();

async function parse(language: keyof typeof GRAMMARS, code: string): Promise<Tree> {
    let grammar = languages.get(language);
    if (!grammar) {
        grammar = await Language.load(GRAMMARS[language]);
        languages.set(language, grammar);
    }
    const parser = new Parser();
    parser.setLanguage(grammar);
    const tree = parser.parse(code);
    parser.delete();
    if (!tree) throw new Error(`Could not parse ${language}`);
    return tree;
}

async function complete(language: keyof typeof GRAMMARS, codeWithCursor: string) {
    const offset = codeWithCursor.indexOf('|');
    const code = codeWithCursor.slice(0, offset) + codeWithCursor.slice(offset + 1);
    const tree = await parse(language, code);
    const facts = extractSyntaxFacts(tree, code, language);
    const result = getIdeCompletionResult(analyzeCompletionDocument(code, language, facts), code, offset);
    tree.delete();
    return result;
}

describe('Tree-sitter syntax facts', () => {
    beforeAll(async () => Parser.init());
    afterAll(() => languages.clear());

    it('masks comments and follows C++ user-defined return types', async () => {
        const result = await complete('cpp', `
// vector<int> fake;
class Graph {
public:
    vector<int> neighbors(int node) { return {}; }
};
Graph graph;
graph.neighbors(1).pu|
`);
        expect(result.items.find((item) => item.label === 'push_back')).toMatchObject({
            insertText: 'push_back(${1:value})',
            returnType: undefined,
        });
    });

    it('extracts Python class members and chained collection types', async () => {
        const result = await complete('python', `
class Graph:
    def neighbors(self, node: int) -> list[int]:
        return []

graph = Graph()
graph.neighbors(1).ap|
`);
        expect(result.items.find((item) => item.label === 'append')?.insertText).toBe('append(${1:value})');
    });

    it('does not leak function-local variables outside their syntax scope', async () => {
        const result = await complete('python', `
def solve():
    items = []
    items.append(1)

items.ap|
`);
        expect(result.context).toBe('member');
        expect(result.items).toEqual([]);

        const globalResult = await complete('python', `
def solve():
    temporary_values = []

temporary_v|
`);
        expect(globalResult.items.some((item) => item.label === 'temporary_values')).toBe(false);
    });

    it('extracts Java methods, fields and chained return types', async () => {
        const result = await complete('java', `
class Graph {
    int size;
    List<Integer> neighbors(int node) { return null; }
}
Graph graph = new Graph();
graph.neighbors(1).ad|
`);
        expect(result.items.find((item) => item.label === 'add')?.detail).toContain('List');
    });

    it('updates syntax trees incrementally after Monaco-style text edits', async () => {
        const language = languages.get('python') || await Language.load(GRAMMARS.python);
        languages.set('python', language);
        const parser = new Parser();
        parser.setLanguage(language);
        const oldCode = 'items = []\nitems.ge';
        const oldTree = parser.parse(oldCode)!;
        const newCode = applyIncrementalTreeEdits(oldTree, oldCode, [{
            rangeOffset: 8,
            rangeLength: 2,
            text: '{}',
        }]);
        expect(newCode).toBe('items = {}\nitems.ge');
        const newTree = parser.parse(newCode!, oldTree)!;
        const facts = extractSyntaxFacts(newTree, newCode!, 'python');
        const result = getIdeCompletionResult(analyzeCompletionDocument(newCode!, 'python', facts), newCode!, newCode!.length);
        expect(result.items.find((item) => item.label === 'get')).toBeTruthy();
        oldTree.delete();
        newTree.delete();
        parser.delete();
    });
});
