export interface CodeTemplate {
    id: string;
    name: string;
    description: string;
    body: string;
}

export interface CompletionSnippet {
    prefix: string;
    label: string;
    detail: string;
    body: string;
}

export type CompletionSymbolKind = 'keyword' | 'class' | 'function' | 'constant' | 'module' | 'property';

export interface CompletionSymbol {
    label: string;
    detail: string;
    kind: CompletionSymbolKind;
    insertText?: string;
}

const MAIN_TEMPLATES: Record<string, CodeTemplate> = {
    cpp: {
        id: 'cpp-main',
        name: 'C++ 竞赛基础模板',
        description: 'bits/stdc++.h、快速 I/O 与 main 函数',
        body: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    // TODO: solve the problem

    return 0;
}
`,
    },
    c: {
        id: 'c-main',
        name: 'C 基础模板',
        description: '标准输入输出与 main 函数',
        body: `#include <stdio.h>

int main(void) {
    // TODO: solve the problem

    return 0;
}
`,
    },
    python: {
        id: 'python-main',
        name: 'Python 竞赛基础模板',
        description: 'solve 函数与标准入口',
        body: `import sys


def solve() -> None:
    # TODO: solve the problem
    pass


if __name__ == "__main__":
    solve()
`,
    },
    java: {
        id: 'java-main',
        name: 'Java 竞赛基础模板',
        description: 'Main 类、BufferedReader 与 StringTokenizer',
        body: `import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws Exception {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));

        // TODO: solve the problem
    }
}
`,
    },
    kotlin: {
        id: 'kotlin-main',
        name: 'Kotlin 竞赛基础模板',
        description: '快速输入与 main 函数',
        body: `import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.StringTokenizer

private class FastScanner {
    private val reader = BufferedReader(InputStreamReader(System.\`in\`))
    private var tokenizer = StringTokenizer("")

    fun next(): String {
        while (!tokenizer.hasMoreTokens()) tokenizer = StringTokenizer(reader.readLine())
        return tokenizer.nextToken()
    }
}

fun main() {
    val fs = FastScanner()
    // TODO: solve the problem
}
`,
    },
    go: {
        id: 'go-main',
        name: 'Go 竞赛基础模板',
        description: 'bufio 快速输入输出与 main 函数',
        body: `package main

import (
    "bufio"
    "fmt"
    "os"
)

func main() {
    in := bufio.NewReader(os.Stdin)
    out := bufio.NewWriter(os.Stdout)
    defer out.Flush()

    // TODO: solve the problem
    _ = in
    _ = fmt.Fprint
}
`,
    },
    rust: {
        id: 'rust-main',
        name: 'Rust 竞赛基础模板',
        description: '一次性读取输入与 main 函数',
        body: `use std::io::{self, Read};

fn main() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap();
    let mut iter = input.split_whitespace();

    // TODO: solve the problem
    let _ = &mut iter;
}
`,
    },
    csharp: {
        id: 'csharp-main',
        name: 'C# 竞赛基础模板',
        description: 'Program 类与 Main 方法',
        body: `using System;
using System.Collections.Generic;

public static class Program
{
    public static void Main()
    {
        // TODO: solve the problem
    }
}
`,
    },
    javascript: {
        id: 'javascript-main',
        name: 'Node.js 竞赛基础模板',
        description: '读取标准输入并调用 solve',
        body: `'use strict';

const fs = require('fs');
const input = fs.readFileSync(0, 'utf8').trim().split(/\\s+/);
let index = 0;

function solve() {
    // TODO: solve the problem
}

solve();
`,
    },
    php: {
        id: 'php-main',
        name: 'PHP 竞赛基础模板',
        description: '读取标准输入并拆分 token',
        body: `<?php

$tokens = preg_split('/\\s+/', trim(stream_get_contents(STDIN)));
$index = 0;

// TODO: solve the problem
`,
    },
    pascal: {
        id: 'pascal-main',
        name: 'Pascal 基础模板',
        description: '标准 program 结构',
        body: `program Main;

begin
    { TODO: solve the problem }
end.
`,
    },
};

const COMMON_CPP: CompletionSnippet[] = [
    {
        prefix: 'fori',
        label: 'fori',
        detail: 'Index-based for loop',
        body: 'for (int ${1:i} = ${2:0}; ${1:i} < ${3:n}; ++${1:i}) {\n    $0\n}',
    },
    {
        prefix: 'fastio',
        label: 'fastio',
        detail: 'Fast C++ iostream setup',
        body: 'ios::sync_with_stdio(false);\ncin.tie(nullptr);',
    },
    {
        prefix: 'bsearch',
        label: 'bsearch',
        detail: 'Binary search for the first valid value',
        body: `long long \${1:left} = \${2:0}, \${3:right} = \${4:n};
while (\${1:left} < \${3:right}) {
    long long mid = \${1:left} + (\${3:right} - \${1:left}) / 2;
    if (\${5:check(mid)}) \${3:right} = mid;
    else \${1:left} = mid + 1;
}
$0`,
    },
    {
        prefix: 'gcd',
        label: 'gcd function',
        detail: 'Euclidean greatest common divisor',
        body: `long long gcd(long long a, long long b) {
    while (b != 0) {
        long long t = a % b;
        a = b;
        b = t;
    }
    return a;
}`,
    },
    {
        prefix: 'modpow',
        label: 'modpow',
        detail: 'Binary modular exponentiation',
        body: `long long modPow(long long base, long long exp, long long mod) {
    long long result = 1 % mod;
    while (exp > 0) {
        if (exp & 1) result = result * base % mod;
        base = base * base % mod;
        exp >>= 1;
    }
    return result;
}`,
    },
];

const LANGUAGE_SNIPPETS: Record<string, CompletionSnippet[]> = {
    cpp: COMMON_CPP,
    c: [
        {
            prefix: 'fori', label: 'fori', detail: 'Index-based for loop',
            body: 'for (int ${1:i} = ${2:0}; ${1:i} < ${3:n}; ++${1:i}) {\n    $0\n}',
        },
    ],
    python: [
        {
            prefix: 'readints', label: 'readints', detail: 'Read a line of integers',
            body: '${1:values} = list(map(int, input().split()))',
        },
        {
            prefix: 'fori', label: 'fori', detail: 'Range-based for loop',
            body: 'for ${1:i} in range(${2:n}):\n    $0',
        },
        {
            prefix: 'bsearch', label: 'bsearch', detail: 'Binary search for the first valid value',
            body: `left, right = \${1:0}, \${2:n}
while left < right:
    mid = (left + right) // 2
    if \${3:check(mid)}:
        right = mid
    else:
        left = mid + 1
$0`,
        },
    ],
    java: [
        {
            prefix: 'fori', label: 'fori', detail: 'Index-based for loop',
            body: 'for (int ${1:i} = ${2:0}; ${1:i} < ${3:n}; ${1:i}++) {\n    $0\n}',
        },
        {
            prefix: 'st', label: 'StringTokenizer', detail: 'Tokenize one input line',
            body: 'StringTokenizer st = new StringTokenizer(br.readLine());',
        },
    ],
    kotlin: [
        {
            prefix: 'fori', label: 'fori', detail: 'Index-based loop',
            body: 'for (${1:i} in 0 until ${2:n}) {\n    $0\n}',
        },
    ],
    go: [
        {
            prefix: 'fori', label: 'fori', detail: 'Index-based for loop',
            body: 'for ${1:i} := ${2:0}; ${1:i} < ${3:n}; ${1:i}++ {\n    $0\n}',
        },
        {
            prefix: 'scan', label: 'fmt.Fscan', detail: 'Scan from buffered input',
            body: 'fmt.Fscan(in, &${1:value})',
        },
    ],
    rust: [
        {
            prefix: 'parse', label: 'parse next token', detail: 'Parse the next whitespace token',
            body: 'let ${1:value}: ${2:i64} = iter.next().unwrap().parse().unwrap();',
        },
    ],
    javascript: [
        {
            prefix: 'nextint', label: 'next integer', detail: 'Read the next integer token',
            body: 'const ${1:value} = Number(input[index++]);',
        },
    ],
};

function symbols(words: string[], kind: CompletionSymbolKind, detail: string): CompletionSymbol[] {
    return words.map((label) => ({ label, kind, detail }));
}

const C_LIKE_KEYWORDS = [
    'break', 'case', 'const', 'continue', 'default', 'do', 'else', 'enum', 'for', 'goto', 'if',
    'return', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'volatile', 'while',
];

const LANGUAGE_SYMBOLS: Record<string, CompletionSymbol[]> = {
    cpp: [
        ...symbols([
            ...C_LIKE_KEYWORDS,
            'alignas', 'alignof', 'and', 'and_eq', 'asm', 'auto', 'bitand', 'bitor', 'bool',
            'catch', 'char', 'char16_t', 'char32_t', 'class', 'compl', 'concept', 'consteval',
            'constexpr', 'constinit', 'const_cast', 'co_await', 'co_return', 'co_yield', 'decltype',
            'delete', 'double', 'dynamic_cast', 'explicit', 'export', 'extern', 'false', 'float',
            'friend', 'inline', 'int', 'long', 'mutable', 'namespace', 'new', 'noexcept', 'not',
            'not_eq', 'nullptr', 'operator', 'or', 'or_eq', 'private', 'protected', 'public',
            'register', 'reinterpret_cast', 'requires', 'short', 'signed', 'static_assert',
            'static_cast', 'template', 'this', 'thread_local', 'throw', 'true', 'try', 'typeid',
            'typename', 'unsigned', 'using', 'virtual', 'void', 'wchar_t', 'xor', 'xor_eq',
        ], 'keyword', 'C++ keyword'),
        ...symbols([
            'array', 'bitset', 'deque', 'forward_list', 'list', 'map', 'multimap', 'multiset',
            'optional', 'pair', 'priority_queue', 'queue', 'set', 'span', 'stack', 'string',
            'string_view', 'tuple', 'unordered_map', 'unordered_multimap', 'unordered_multiset',
            'unordered_set', 'variant', 'vector',
        ], 'class', 'C++ standard library type'),
        ...symbols([
            'accumulate', 'all_of', 'any_of', 'binary_search', 'clamp', 'count', 'count_if',
            'equal_range', 'fill', 'find', 'find_if', 'gcd', 'iota', 'is_sorted', 'lcm',
            'lower_bound', 'make_pair', 'make_tuple', 'max', 'max_element', 'merge', 'min',
            'min_element', 'next_permutation', 'none_of', 'nth_element', 'partial_sort',
            'prev_permutation', 'reverse', 'rotate', 'sort', 'stable_sort', 'swap', 'transform',
            'unique', 'upper_bound',
        ], 'function', 'C++ standard library function'),
        ...symbols([
            'begin', 'cbegin', 'cend', 'cin', 'cerr', 'clog', 'cout', 'emplace', 'emplace_back',
            'end', 'endl', 'fixed', 'greater', 'less', 'make_heap', 'numeric_limits', 'pop_back',
            'pop_heap', 'push_back', 'push_heap', 'setprecision', 'size',
        ], 'property', 'Common C++ standard library symbol'),
        ...symbols(['INT_MAX', 'INT_MIN', 'LLONG_MAX', 'LLONG_MIN', 'MOD', 'NULL'], 'constant', 'Common constant'),
    ],
    c: [
        ...symbols([
            ...C_LIKE_KEYWORDS, '_Alignas', '_Alignof', '_Atomic', '_Bool', '_Complex', '_Generic',
            '_Imaginary', '_Noreturn', '_Static_assert', '_Thread_local', 'auto', 'char', 'double',
            'extern', 'float', 'inline', 'int', 'long', 'register', 'restrict', 'short', 'signed',
            'unsigned', 'void',
        ], 'keyword', 'C keyword'),
        ...symbols([
            'abs', 'calloc', 'fclose', 'fgets', 'fopen', 'fprintf', 'free', 'getchar', 'malloc',
            'memcpy', 'memset', 'printf', 'putchar', 'puts', 'qsort', 'realloc', 'scanf', 'snprintf',
            'sprintf', 'sscanf', 'strcmp', 'strcpy', 'strlen', 'strncmp', 'strncpy',
        ], 'function', 'C standard library function'),
        ...symbols(['FILE', 'int32_t', 'int64_t', 'size_t', 'uint32_t', 'uint64_t'], 'class', 'C standard library type'),
        ...symbols(['EOF', 'INT_MAX', 'INT_MIN', 'LLONG_MAX', 'LLONG_MIN', 'NULL'], 'constant', 'C standard constant'),
    ],
    python: [
        ...symbols([
            'and', 'as', 'assert', 'async', 'await', 'break', 'case', 'class', 'continue', 'def',
            'del', 'elif', 'else', 'except', 'False', 'finally', 'for', 'from', 'global', 'if',
            'import', 'in', 'is', 'lambda', 'match', 'None', 'nonlocal', 'not', 'or', 'pass',
            'raise', 'return', 'True', 'try', 'while', 'with', 'yield',
        ], 'keyword', 'Python keyword'),
        ...symbols([
            'all', 'any', 'bin', 'bool', 'bytearray', 'bytes', 'callable', 'chr', 'dict',
            'divmod', 'enumerate', 'filter', 'float', 'frozenset', 'getattr', 'hasattr', 'hash',
            'hex', 'input', 'int', 'isinstance', 'issubclass', 'iter', 'len', 'list', 'map', 'max',
            'min', 'next', 'object', 'oct', 'open', 'ord', 'pow', 'print', 'range', 'repr', 'reversed',
            'round', 'set', 'slice', 'sorted', 'str', 'sum', 'super', 'tuple', 'type', 'zip',
        ], 'function', 'Python built-in'),
        ...symbols([
            'bisect', 'collections', 'functools', 'heapq', 'itertools', 'math', 'operator', 'queue',
            'random', 'sys',
        ], 'module', 'Python standard library module'),
        ...symbols(['Counter', 'defaultdict', 'deque', 'lru_cache'], 'class', 'Common Python standard library symbol'),
    ],
    java: [
        ...symbols([
            'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class',
            'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'false',
            'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof',
            'int', 'interface', 'long', 'native', 'new', 'null', 'package', 'private', 'protected',
            'public', 'record', 'return', 'sealed', 'short', 'static', 'strictfp', 'super', 'switch',
            'synchronized', 'this', 'throw', 'throws', 'transient', 'true', 'try', 'var', 'void',
            'volatile', 'while', 'yield',
        ], 'keyword', 'Java keyword'),
        ...symbols([
            'ArrayDeque', 'ArrayList', 'Arrays', 'BigInteger', 'BufferedReader', 'BufferedWriter',
            'Collections', 'Comparator', 'HashMap', 'HashSet', 'LinkedHashMap', 'LinkedList', 'List',
            'Map', 'Math', 'PriorityQueue', 'Queue', 'Scanner', 'Set', 'String', 'StringBuilder',
            'StringTokenizer', 'TreeMap', 'TreeSet',
        ], 'class', 'Java standard library type'),
        ...symbols(['binarySearch', 'compare', 'max', 'min', 'sort'], 'function', 'Common Java standard library method'),
    ],
    kotlin: [
        ...symbols([
            'as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if', 'in',
            'interface', 'is', 'null', 'object', 'package', 'return', 'super', 'this', 'throw', 'true',
            'try', 'typealias', 'typeof', 'val', 'var', 'when', 'while',
        ], 'keyword', 'Kotlin keyword'),
        ...symbols([
            'Array', 'ArrayDeque', 'HashMap', 'HashSet', 'IntArray', 'List', 'LongArray', 'Map',
            'MutableList', 'MutableMap', 'MutableSet', 'Pair', 'PriorityQueue', 'Queue', 'Set',
            'StringBuilder',
        ], 'class', 'Common Kotlin/JVM type'),
        ...symbols(['listOf', 'mapOf', 'maxOf', 'minOf', 'mutableListOf', 'readLine', 'setOf'], 'function', 'Kotlin standard function'),
    ],
    go: [
        ...symbols([
            'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough',
            'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range',
            'return', 'select', 'struct', 'switch', 'type', 'var',
        ], 'keyword', 'Go keyword'),
        ...symbols([
            'append', 'bool', 'byte', 'cap', 'close', 'complex', 'complex64', 'complex128', 'copy',
            'delete', 'error', 'float32', 'float64', 'imag', 'int', 'int8', 'int16', 'int32', 'int64',
            'len', 'make', 'new', 'panic', 'print', 'println', 'real', 'recover', 'rune', 'string',
            'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr',
        ], 'function', 'Go predeclared identifier'),
        ...symbols(['bufio', 'fmt', 'math', 'os', 'sort', 'strconv', 'strings'], 'module', 'Common Go package'),
    ],
    rust: [
        ...symbols([
            'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum',
            'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move',
            'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super', 'trait', 'true',
            'type', 'unsafe', 'use', 'where', 'while',
        ], 'keyword', 'Rust keyword'),
        ...symbols([
            'BinaryHeap', 'BTreeMap', 'BTreeSet', 'HashMap', 'HashSet', 'Option', 'Result', 'String',
            'Vec', 'VecDeque',
        ], 'class', 'Common Rust standard library type'),
        ...symbols(['eprintln', 'format', 'print', 'println', 'vec'], 'function', 'Common Rust macro'),
    ],
    csharp: [
        ...symbols([
            'abstract', 'as', 'async', 'await', 'base', 'bool', 'break', 'byte', 'case', 'catch',
            'char', 'checked', 'class', 'const', 'continue', 'decimal', 'default', 'delegate', 'do',
            'double', 'else', 'enum', 'event', 'explicit', 'extern', 'false', 'finally', 'fixed',
            'float', 'for', 'foreach', 'goto', 'if', 'implicit', 'in', 'int', 'interface', 'internal',
            'is', 'lock', 'long', 'namespace', 'new', 'null', 'object', 'operator', 'out', 'override',
            'params', 'private', 'protected', 'public', 'readonly', 'record', 'ref', 'return', 'sbyte',
            'sealed', 'short', 'sizeof', 'stackalloc', 'static', 'string', 'struct', 'switch', 'this',
            'throw', 'true', 'try', 'typeof', 'uint', 'ulong', 'unchecked', 'unsafe', 'ushort', 'using',
            'var', 'virtual', 'void', 'volatile', 'while', 'yield',
        ], 'keyword', 'C# keyword'),
        ...symbols([
            'Array', 'Console', 'Dictionary', 'HashSet', 'List', 'Math', 'PriorityQueue', 'Queue',
            'SortedDictionary', 'SortedSet', 'Stack', 'StringBuilder',
        ], 'class', 'Common .NET type'),
    ],
    javascript: [
        ...symbols([
            'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
            'default', 'delete', 'do', 'else', 'export', 'extends', 'false', 'finally', 'for', 'from',
            'function', 'get', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'of', 'return',
            'set', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined',
            'var', 'void', 'while', 'with', 'yield',
        ], 'keyword', 'JavaScript keyword'),
        ...symbols([
            'Array', 'BigInt', 'Boolean', 'Date', 'Error', 'JSON', 'Map', 'Math', 'Number', 'Object',
            'Promise', 'RegExp', 'Set', 'String', 'WeakMap', 'WeakSet',
        ], 'class', 'JavaScript built-in'),
        ...symbols(['console', 'parseFloat', 'parseInt', 'require'], 'function', 'Common JavaScript/Node.js symbol'),
    ],
};

const ALIASES: Record<string, string> = {
    cc: 'cpp',
    'c++': 'cpp',
    py: 'python',
    py3: 'python',
    js: 'javascript',
    node: 'javascript',
    nodejs: 'javascript',
    kt: 'kotlin',
    rs: 'rust',
    cs: 'csharp',
    golang: 'go',
    pas: 'pascal',
};

export function normalizeLanguage(language: string): string {
    const base = (language || '').toLowerCase().split('.')[0];
    return ALIASES[base] || base;
}

export function getTemplates(language: string): CodeTemplate[] {
    const template = MAIN_TEMPLATES[normalizeLanguage(language)];
    return template ? [template] : [];
}

export function getCompletionSnippets(language: string): CompletionSnippet[] {
    const normalized = normalizeLanguage(language);
    const main = MAIN_TEMPLATES[normalized];
    const snippets = LANGUAGE_SNIPPETS[normalized] || [];
    if (!main) return snippets;
    return [
        {
            prefix: 'main',
            label: main.name,
            detail: main.description,
            body: main.body,
        },
        ...snippets,
    ];
}

export function getCompletionSymbols(language: string, prefix = ''): CompletionSymbol[] {
    const normalized = normalizeLanguage(language);
    const query = prefix.toLowerCase();
    const unique = new Map<string, CompletionSymbol>();
    for (const item of LANGUAGE_SYMBOLS[normalized] || []) {
        if (query && !item.label.toLowerCase().startsWith(query)) continue;
        if (!unique.has(item.label)) unique.set(item.label, item);
    }
    return Array.from(unique.values()).sort((left, right) => {
        const leftExact = left.label.toLowerCase() === query ? 0 : 1;
        const rightExact = right.label.toLowerCase() === query ? 0 : 1;
        return leftExact - rightExact || left.label.localeCompare(right.label);
    });
}

export function getSupportedLanguages(): string[] {
    return Array.from(new Set([
        ...Object.keys(MAIN_TEMPLATES),
        ...Object.keys(LANGUAGE_SNIPPETS),
    ]));
}
