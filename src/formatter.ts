import { normalizeLanguage } from './catalog';

interface LexState {
    blockComment: boolean;
}

interface BraceInfo {
    opens: number;
    closes: number;
    leadingCloses: number;
}

const BRACE_LANGUAGES = new Set([
    'c', 'cpp', 'java', 'kotlin', 'csharp', 'javascript', 'typescript', 'go', 'rust', 'php',
]);

function inspectBraces(line: string, state: LexState): BraceInfo {
    let opens = 0;
    let closes = 0;
    let leadingCloses = 0;
    let quote = '';
    let escaped = false;
    let seenCode = false;

    for (let index = 0; index < line.length; index++) {
        const char = line[index];
        const next = line[index + 1];
        if (state.blockComment) {
            if (char === '*' && next === '/') {
                state.blockComment = false;
                index++;
            }
            continue;
        }
        if (quote) {
            if (escaped) escaped = false;
            else if (char === '\\') escaped = true;
            else if (char === quote) quote = '';
            continue;
        }
        if (char === '/' && next === '/') break;
        if (char === '/' && next === '*') {
            state.blockComment = true;
            index++;
            continue;
        }
        if (char === '"' || char === "'" || char === '`') {
            quote = char;
            seenCode = true;
            continue;
        }
        if (!/\s/.test(char) && char !== '}') seenCode = true;
        if (char === '{') opens++;
        if (char === '}') {
            closes++;
            if (!seenCode) leadingCloses++;
        }
    }
    return { opens, closes, leadingCloses };
}

function trimTrailingWhitespace(source: string): string {
    const lines = source.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[ \t]+$/g, ''));
    while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return `${lines.join('\n')}\n`;
}

function formatBraceLanguage(source: string, tabSize: number): string {
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const state: LexState = { blockComment: false };
    const output: string[] = [];
    let depth = 0;
    const indent = ' '.repeat(Math.max(1, Math.min(8, tabSize || 4)));

    for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed) {
            if (output.length && output[output.length - 1] !== '') output.push('');
            continue;
        }
        const info = inspectBraces(trimmed, state);
        const isPreprocessor = trimmed.startsWith('#');
        const currentDepth = isPreprocessor ? 0 : Math.max(0, depth - info.leadingCloses);
        output.push(`${indent.repeat(currentDepth)}${trimmed}`);
        depth = Math.max(0, depth + info.opens - info.closes);
    }

    while (output.length > 1 && output[output.length - 1] === '') output.pop();
    return `${output.join('\n')}\n`;
}

export function formatCode(source: string, language: string, tabSize = 4): string {
    if (!source.trim()) return '';
    const normalized = normalizeLanguage(language);
    if (BRACE_LANGUAGES.has(normalized)) return formatBraceLanguage(source, tabSize);
    return trimTrailingWhitespace(source);
}

export function supportsFallbackFormatting(language: string): boolean {
    const normalized = normalizeLanguage(language);
    return BRACE_LANGUAGES.has(normalized) || [
        'python', 'ruby', 'bash', 'shell', 'pascal', 'haskell', 'r',
    ].includes(normalized);
}
