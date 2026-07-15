import { normalizeLanguage } from './catalog';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface CodeDiagnostic {
    severity: DiagnosticSeverity;
    message: string;
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
    code: string;
}

interface Delimiter {
    char: string;
    line: number;
    column: number;
}

const OPENING = new Set(['(', '[', '{']);
const CLOSING: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
const EXPECTED: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const FULL_WIDTH: Record<string, string> = {
    '；': ';',
    '，': ',',
    '（': '(',
    '）': ')',
    '｛': '{',
    '｝': '}',
    '［': '[',
    '］': ']',
    '：': ':',
    '“': '"',
    '”': '"',
    '‘': "'",
    '’': "'",
};

function diagnostic(
    severity: DiagnosticSeverity,
    message: string,
    line: number,
    column: number,
    code: string,
    length = 1,
): CodeDiagnostic {
    return {
        severity,
        message,
        line,
        column,
        endLine: line,
        endColumn: column + Math.max(1, length),
        code,
    };
}

function maskNonCode(source: string, language: string): string {
    const normalized = normalizeLanguage(language);
    const hashComment = ['python', 'ruby', 'bash', 'shell'].includes(normalized);
    let output = '';
    let quote = '';
    let blockComment = false;
    let lineComment = false;
    let escaped = false;

    for (let index = 0; index < source.length; index++) {
        const char = source[index];
        const next = source[index + 1];
        if (char === '\n') {
            output += '\n';
            lineComment = false;
            if (quote && quote !== '`') quote = '';
            escaped = false;
            continue;
        }
        if (lineComment) {
            output += ' ';
            continue;
        }
        if (blockComment) {
            if (char === '*' && next === '/') {
                output += '  ';
                index++;
                blockComment = false;
            } else output += ' ';
            continue;
        }
        if (quote) {
            output += ' ';
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = '';
            continue;
        }
        if (char === '/' && next === '/') {
            output += '  ';
            index++;
            lineComment = true;
        } else if (char === '/' && next === '*') {
            output += '  ';
            index++;
            blockComment = true;
        } else if (hashComment && char === '#') {
            output += ' ';
            lineComment = true;
        } else if (char === '"' || char === "'" || (char === '`' && normalized === 'javascript')) {
            output += ' ';
            quote = char;
        } else output += char;
    }
    return output;
}

export function diagnoseCode(source: string, language: string): CodeDiagnostic[] {
    const normalized = normalizeLanguage(language);
    const masked = maskNonCode(source.replace(/\r\n?/g, '\n'), normalized);
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const maskedLines = masked.split('\n');
    const results: CodeDiagnostic[] = [];
    const delimiters: Delimiter[] = [];

    for (let lineIndex = 0; lineIndex < maskedLines.length; lineIndex++) {
        const line = lines[lineIndex] || '';
        const codeLine = maskedLines[lineIndex] || '';

        if (/^(<{7}|={7}|>{7})(?:\s|$)/.test(line)) {
            results.push(diagnostic(
                'error',
                '检测到未解决的 Git 合并冲突标记。',
                lineIndex + 1,
                1,
                'merge-conflict',
                Math.min(7, line.length),
            ));
        }

        for (let columnIndex = 0; columnIndex < codeLine.length; columnIndex++) {
            const char = codeLine[columnIndex];
            if (FULL_WIDTH[char]) {
                results.push(diagnostic(
                    'warning',
                    `全角符号“${char}”可能是误输入，建议改为“${FULL_WIDTH[char]}”。`,
                    lineIndex + 1,
                    columnIndex + 1,
                    'full-width-punctuation',
                ));
            }
            if (OPENING.has(char)) {
                delimiters.push({ char, line: lineIndex + 1, column: columnIndex + 1 });
                continue;
            }
            if (!CLOSING[char]) continue;
            const opening = delimiters[delimiters.length - 1];
            if (!opening) {
                results.push(diagnostic(
                    'error',
                    `没有与“${char}”匹配的左括号。`,
                    lineIndex + 1,
                    columnIndex + 1,
                    'unmatched-closing-delimiter',
                ));
            } else if (opening.char !== CLOSING[char]) {
                results.push(diagnostic(
                    'error',
                    `括号不匹配：此处需要“${EXPECTED[opening.char]}”。`,
                    lineIndex + 1,
                    columnIndex + 1,
                    'mismatched-delimiter',
                ));
            } else delimiters.pop();
        }

        if (normalized === 'python' && /^(?=\s)(?=[ \t]*\t)(?=[ \t]* )/.test(line) && line.trim()) {
            const indentation = line.match(/^[ \t]+/)?.[0] || '';
            if (indentation.includes(' ') && indentation.includes('\t')) {
                results.push(diagnostic(
                    'warning',
                    '缩进同时包含空格和制表符，可能触发 TabError。',
                    lineIndex + 1,
                    1,
                    'mixed-indentation',
                    indentation.length,
                ));
            }
        }

        if (['c', 'cpp', 'java', 'kotlin', 'csharp', 'javascript'].includes(normalized)) {
            const match = codeLine.match(/\b(if|for|while)\s*\([^;{}]*\)\s*;/);
            if (match && match.index != null) {
                const semicolonOffset = match[0].lastIndexOf(';');
                results.push(diagnostic(
                    'warning',
                    `“${match[1]}”条件后存在空语句，请确认这个分号是有意的。`,
                    lineIndex + 1,
                    match.index + semicolonOffset + 1,
                    'empty-control-statement',
                ));
            }
        }
    }

    for (const opening of delimiters) {
        results.push(diagnostic(
            'error',
            `“${opening.char}”缺少匹配的“${EXPECTED[opening.char]}”。`,
            opening.line,
            opening.column,
            'unclosed-delimiter',
        ));
    }

    const meaningfulCode = masked.trim();
    if (meaningfulCode && lines.length >= 3) {
        const mainPatterns: Partial<Record<string, RegExp>> = {
            c: /\bmain\s*\(/,
            cpp: /\bmain\s*\(/,
            java: /\bstatic\s+void\s+main\s*\(/,
            kotlin: /\bfun\s+main\s*\(/,
            go: /\bfunc\s+main\s*\(/,
            rust: /\bfn\s+main\s*\(/,
            csharp: /\bstatic\s+(?:void|int)\s+Main\s*\(/,
        };
        const mainPattern = mainPatterns[normalized];
        if (mainPattern && !mainPattern.test(masked)) {
            results.push(diagnostic(
                'warning',
                '未检测到程序入口函数，请确认提交的是完整程序。',
                1,
                1,
                'missing-entry-point',
            ));
        }
    }

    if (normalized === 'java') {
        const publicClass = masked.match(/\bpublic\s+class\s+([A-Za-z_$][\w$]*)/);
        if (publicClass && publicClass[1] !== 'Main') {
            const before = masked.slice(0, publicClass.index!);
            const line = before.split('\n').length;
            const column = before.length - before.lastIndexOf('\n');
            results.push(diagnostic(
                'warning',
                `Hydro 默认将源码保存为 Main.java，公开类“${publicClass[1]}”可能导致编译失败。`,
                line,
                column,
                'java-main-class',
                publicClass[0].length,
            ));
        }
    }

    return results;
}
