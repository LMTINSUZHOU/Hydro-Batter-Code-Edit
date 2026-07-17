import { describe, expect, it } from 'vitest';
import {
    analyzeCompletionDocument, getIdeCompletionResult, getIdeSignatureHelp, IdeCompletionResult,
} from '../src/completion-engine';

function complete(language: string, codeWithCursor: string): IdeCompletionResult {
    const offset = codeWithCursor.indexOf('|');
    const code = codeWithCursor.slice(0, offset) + codeWithCursor.slice(offset + 1);
    return getIdeCompletionResult(analyzeCompletionDocument(code, language), code, offset);
}

function item(result: IdeCompletionResult, label: string) {
    return result.items.find((candidate) => candidate.label === label);
}

describe('IDE-like contextual completion engine', () => {
    it('infers C++ STL containers and supplies typed member snippets', () => {
        const vector = complete('cpp', 'vector<int> values;\nvalues.pu|');
        expect(vector.context).toBe('member');
        expect(item(vector, 'push_back')).toMatchObject({
            insertText: 'push_back(${1:value})',
            kind: 'method',
            snippet: true,
        });
        expect(item(vector, 'push_back')?.detail).toContain('values: vector');

        const priorityQueue = complete('cpp', 'priority_queue<int> pending;\npending.to|');
        expect(item(priorityQueue, 'top')?.insertText).toBe('top()');
        expect(item(complete('cpp', 'auto values = vector<int>();\nvalues.rese|'), 'reserve')).toBeTruthy();
        expect(item(complete('cpp', 'string value;\nvalue.substr(1).len|'), 'length')).toBeTruthy();
    });

    it('completes C++ includes, namespaces and functions declared in the file', () => {
        expect(item(complete('cpp', '#include <vec|'), 'vector')?.replacement).toEqual({ start: 10, end: 13 });
        expect(item(complete('cpp', 'std::lower_|'), 'lower_bound')).toBeTruthy();
        const local = complete('cpp', 'long long distance(int source, int target) { return 0; }\ndis|');
        expect(item(local, 'distance')).toMatchObject({
            insertText: 'distance(${1:source}, ${2:target})',
            kind: 'function',
        });
    });

    it('infers Python collections, annotations and imported modules', () => {
        expect(item(complete('python', 'items: list[int] = []\nitems.ap|'), 'append')?.insertText)
            .toBe('append(${1:value})');
        expect(item(complete('python', 'lookup = {}\nlookup.ge|'), 'get')?.detail).toContain('lookup: dict');
        expect(item(complete('python', 'point = (2, 3)\npoint.co|'), 'count')).toBeTruthy();
        expect(item(complete('python', 'items = []\nitems.copy().ap|'), 'append')).toBeTruthy();
        expect(item(complete('python', 'values = [3, 1]\nsorted(values).ap|'), 'append')).toBeTruthy();
        expect(item(complete('python', 'import math\nmath.sq|'), 'sqrt')).toBeTruthy();
        expect(item(complete('python', 'from coll|'), 'collections.deque')).toBeTruthy();
    });

    it('completes Python functions declared in the current file with parameters', () => {
        const result = complete('python', 'def shortest_path(graph: list, start: int):\n    pass\nsho|');
        expect(item(result, 'shortest_path')).toMatchObject({
            insertText: 'shortest_path(${1:graph}, ${2:start})',
            kind: 'function',
            snippet: true,
        });
    });

    it('infers Java collections and ranks camel/subsequence member matches', () => {
        const list = complete('java', 'List<Integer> values = new ArrayList<>();\nvalues.ad|');
        expect(item(list, 'add')?.insertText).toBe('add(${1:value})');

        const map = complete('java', 'Map<String, Integer> counts = new HashMap<>();\ncounts.gOD|');
        expect(item(map, 'getOrDefault')?.insertText).toBe('getOrDefault(${1:key}, ${2:defaultValue})');
        expect(item(complete('java', 'var queue = new ArrayDeque<Integer>();\nqueue.pollF|'), 'pollFirst')).toBeTruthy();

        const arrays = complete('java', 'Arrays.bi|');
        expect(item(arrays, 'binarySearch')?.detail).toContain('static int Arrays.binarySearch');
        expect(item(complete('java', 'int[] distance = new int[10];\ndistance.len|'), 'length')?.kind).toBe('field');
        expect(item(complete('java', 'StringBuilder out = new StringBuilder();\nout.append("x").rev|'), 'reverse')).toBeTruthy();
    });

    it('completes Java imports and methods declared in the file', () => {
        expect(item(complete('java', 'import java.util.Arr|'), 'java.util.ArrayList')).toBeTruthy();
        const local = complete('java', 'static int solveCase(int left, int right) { return 0; }\nsol|');
        expect(item(local, 'solveCase')?.insertText).toBe('solveCase(${1:left}, ${2:right})');
    });

    it('provides active-parameter signature help for all enhanced languages', () => {
        const cpp = 'vector<int> values;\nvalues.push_back(';
        expect(getIdeSignatureHelp(analyzeCompletionDocument(cpp, 'cpp'), cpp, cpp.length)).toMatchObject({
            activeParameter: 0,
            signatures: [expect.objectContaining({ label: 'void push_back(const T& value)' })],
        });

        const python = 'def shortest_path(graph, start):\n    pass\nshortest_path(graph, ';
        expect(getIdeSignatureHelp(analyzeCompletionDocument(python, 'python'), python, python.length)).toMatchObject({
            activeParameter: 1,
            signatures: [expect.objectContaining({ parameters: [{ label: 'graph' }, { label: 'start' }] })],
        });

        const java = 'Map<String, Integer> counts = new HashMap<>();\ncounts.getOrDefault(key, ';
        expect(getIdeSignatureHelp(analyzeCompletionDocument(java, 'java'), java, java.length)).toMatchObject({
            activeParameter: 1,
            signatures: [expect.objectContaining({ label: 'V getOrDefault(Object key, V defaultValue)' })],
        });
    });
});
