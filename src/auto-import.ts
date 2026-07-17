import { normalizeLanguage } from './catalog';

export interface AdditionalCodeEdit {
    start: number;
    end: number;
    text: string;
    description: string;
}

const CPP_HEADERS: Record<string, string> = {
    array: 'array', bitset: 'bitset', deque: 'deque', list: 'list', map: 'map', multimap: 'map',
    priority_queue: 'queue', queue: 'queue', set: 'set', multiset: 'set', stack: 'stack',
    string: 'string', string_view: 'string_view', unordered_map: 'unordered_map',
    unordered_multimap: 'unordered_map', unordered_set: 'unordered_set',
    unordered_multiset: 'unordered_set', vector: 'vector',
    sort: 'algorithm', stable_sort: 'algorithm', lower_bound: 'algorithm', upper_bound: 'algorithm',
    binary_search: 'algorithm', min: 'algorithm', max: 'algorithm', reverse: 'algorithm',
    accumulate: 'numeric', gcd: 'numeric', lcm: 'numeric', iota: 'numeric',
    setprecision: 'iomanip', fixed: 'iomanip',
};

const PYTHON_IMPORTS: Record<string, string> = {
    bisect: 'import bisect', collections: 'import collections', functools: 'import functools',
    heapq: 'import heapq', itertools: 'import itertools', math: 'import math', operator: 'import operator',
    queue: 'import queue', random: 'import random', sys: 'import sys',
    Counter: 'from collections import Counter', defaultdict: 'from collections import defaultdict',
    deque: 'from collections import deque', lru_cache: 'from functools import lru_cache',
};

const JAVA_IMPORTS: Record<string, string> = {
    ArrayDeque: 'java.util.ArrayDeque', ArrayList: 'java.util.ArrayList', Arrays: 'java.util.Arrays',
    Collections: 'java.util.Collections', Comparator: 'java.util.Comparator', HashMap: 'java.util.HashMap',
    HashSet: 'java.util.HashSet', LinkedHashMap: 'java.util.LinkedHashMap', LinkedList: 'java.util.LinkedList',
    List: 'java.util.List', Map: 'java.util.Map', PriorityQueue: 'java.util.PriorityQueue',
    Queue: 'java.util.Queue', Scanner: 'java.util.Scanner', Set: 'java.util.Set',
    StringTokenizer: 'java.util.StringTokenizer', TreeMap: 'java.util.TreeMap', TreeSet: 'java.util.TreeSet',
    BigInteger: 'java.math.BigInteger', BufferedReader: 'java.io.BufferedReader',
    BufferedWriter: 'java.io.BufferedWriter',
};

function lineEndAfter(code: string, index: number): number {
    const lineEnd = code.indexOf('\n', index);
    return lineEnd === -1 ? code.length : lineEnd + 1;
}

function insertionText(code: string, offset: number, statement: string): string {
    const needsLeadingBreak = offset > 0 && code[offset - 1] !== '\n';
    return `${needsLeadingBreak ? '\n' : ''}${statement}\n`;
}

function cppEdit(code: string, symbol: string): AdditionalCodeEdit | undefined {
    const header = CPP_HEADERS[symbol];
    if (!header || /^[ \t]*#[ \t]*include[ \t]*[<"]bits\/stdc\+\+\.h[>"]/m.test(code)) return undefined;
    const includePattern = /^[ \t]*#[ \t]*include[ \t]*[<"]([^>"]+)[>"][^\n]*$/gm;
    let insertionOffset = 0;
    for (const match of code.matchAll(includePattern)) {
        if (match[1] === header) return undefined;
        insertionOffset = lineEndAfter(code, match.index);
    }
    return {
        start: insertionOffset,
        end: insertionOffset,
        text: insertionText(code, insertionOffset, `#include <${header}>`),
        description: `Add #include <${header}>`,
    };
}

function pythonEdit(code: string, symbol: string): AdditionalCodeEdit | undefined {
    const statement = PYTHON_IMPORTS[symbol];
    if (!statement) return undefined;
    const escaped = statement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`^[ \\t]*${escaped}(?:[ \\t]*(?:#.*)?)?$`, 'm').test(code)) return undefined;
    if (statement.startsWith('from ')) {
        const [, moduleName, importedName] = statement.match(/^from\s+(\S+)\s+import\s+(\S+)$/) || [];
        const existing = new RegExp(`^[ \\t]*from\\s+${moduleName?.replace('.', '\\.') || ''}\\s+import\\s+[^\\n#]*\\b${importedName || ''}\\b`, 'm');
        if (existing.test(code)) return undefined;
    }
    let insertionOffset = 0;
    const firstLineEnd = lineEndAfter(code, 0);
    const firstLine = code.slice(0, firstLineEnd);
    if (firstLine.startsWith('#!')) {
        insertionOffset = firstLineEnd;
        const secondLineEnd = lineEndAfter(code, firstLineEnd);
        if (/coding[:=]/.test(code.slice(firstLineEnd, secondLineEnd))) insertionOffset = secondLineEnd;
    } else if (/coding[:=]/.test(firstLine)) insertionOffset = firstLineEnd;
    const importPattern = /^[ \t]*(?:from\s+[\w.]+\s+import\s+[^\n]+|import\s+[^\n]+)$/gm;
    for (const match of code.matchAll(importPattern)) insertionOffset = lineEndAfter(code, match.index);
    return {
        start: insertionOffset,
        end: insertionOffset,
        text: insertionText(code, insertionOffset, statement),
        description: `Add ${statement}`,
    };
}

function javaEdit(code: string, symbol: string): AdditionalCodeEdit | undefined {
    const qualifiedName = JAVA_IMPORTS[symbol];
    if (!qualifiedName) return undefined;
    const packageName = qualifiedName.slice(0, qualifiedName.lastIndexOf('.'));
    if (new RegExp(`^[ \\t]*import\\s+(?:${qualifiedName.replace(/\./g, '\\.')}|${packageName.replace(/\./g, '\\.')}\\.\\*)\\s*;`, 'm').test(code)) return undefined;
    let insertionOffset = 0;
    const packageMatch = code.match(/^[ \t]*package\s+[\w.]+\s*;[^\n]*$/m);
    if (packageMatch?.index !== undefined) insertionOffset = lineEndAfter(code, packageMatch.index);
    const importPattern = /^[ \t]*import\s+[\w.*]+\s*;[^\n]*$/gm;
    for (const match of code.matchAll(importPattern)) insertionOffset = lineEndAfter(code, match.index);
    return {
        start: insertionOffset,
        end: insertionOffset,
        text: insertionText(code, insertionOffset, `import ${qualifiedName};`),
        description: `Add import ${qualifiedName}`,
    };
}

export function getAutoImportEdit(code: string, language: string, symbol: string): AdditionalCodeEdit | undefined {
    const normalized = normalizeLanguage(language);
    if (normalized === 'cpp') return cppEdit(code, symbol);
    if (normalized === 'python') return pythonEdit(code, symbol);
    if (normalized === 'java') return javaEdit(code, symbol);
    return undefined;
}
