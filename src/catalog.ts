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

export function getSupportedLanguages(): string[] {
    return Array.from(new Set([
        ...Object.keys(MAIN_TEMPLATES),
        ...Object.keys(LANGUAGE_SNIPPETS),
    ]));
}
