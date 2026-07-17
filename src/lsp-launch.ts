import {
    accessSync, constants, readdirSync,
} from 'node:fs';
import {
    delimiter, extname, isAbsolute, join, resolve, sep,
} from 'node:path';
import { normalizeLanguage } from './catalog';

export type LspLanguage = 'cpp' | 'python' | 'java';

export interface LspServerSettings {
    clangdCommand: string;
    cppCompilerCommand: string;
    pyrightCommand: string;
    jdtlsCommand: string;
}

export interface LspLaunch {
    command: string;
    args: string[];
    serverName: 'clangd' | 'Pyright' | 'JDT LS';
    fileName: string;
    compilerCommand?: string;
}

const FILE_NAMES: Record<LspLanguage, string> = {
    cpp: 'main.cpp',
    python: 'main.py',
    java: 'Main.java',
};

export function normalizeLspLanguage(language: string): LspLanguage | undefined {
    const normalized = normalizeLanguage(language);
    return ['cpp', 'python', 'java'].includes(normalized) ? normalized as LspLanguage : undefined;
}

function validateCommand(command: string): string {
    const value = command.trim();
    if (!value || value.length > 4096 || /[\0\r\n]/.test(value)) throw new Error('Invalid language server command');
    return value;
}

export function buildLspLaunch(
    language: LspLanguage,
    workspace: string,
    settings: LspServerSettings,
): LspLaunch {
    if (language === 'cpp') {
        return {
            command: validateCommand(settings.clangdCommand),
            args: ['--background-index=false'],
            serverName: 'clangd',
            fileName: FILE_NAMES.cpp,
            compilerCommand: validateCommand(settings.cppCompilerCommand),
        };
    }
    if (language === 'python') {
        if (settings.pyrightCommand.trim() === 'bundled') {
            return {
                command: process.execPath,
                args: [require.resolve('pyright/langserver.index.js'), '--stdio'],
                serverName: 'Pyright',
                fileName: FILE_NAMES.python,
            };
        }
        return {
            command: validateCommand(settings.pyrightCommand),
            args: ['--stdio'],
            serverName: 'Pyright',
            fileName: FILE_NAMES.python,
        };
    }
    return {
        command: validateCommand(settings.jdtlsCommand),
        args: ['-data', workspace],
        serverName: 'JDT LS',
        fileName: FILE_NAMES.java,
    };
}

function executableCandidates(command: string): string[] {
    if (isAbsolute(command) || command.includes('/') || command.includes('\\')) return [resolve(command)];
    const extensions = process.platform === 'win32' && !extname(command)
        ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
        : [''];
    return (process.env.PATH || '').split(delimiter).flatMap((directory) => extensions.map((extension) => (
        join(directory, process.platform === 'win32' ? `${command}${extension}` : command)
    )));
}

export function resolveExecutable(command: string): string | undefined {
    return executableCandidates(validateCommand(command)).find((candidate) => {
        try {
            accessSync(candidate, constants.X_OK);
            return true;
        } catch {
            return false;
        }
    });
}

function versionedGnuCompilers(): string[] {
    const candidates: string[] = [];
    const directories = new Set((process.env.PATH || '').split(delimiter));
    if (process.platform === 'darwin') {
        directories.add('/opt/homebrew/bin');
        directories.add('/usr/local/bin');
    }
    for (const directory of directories) {
        if (!directory) continue;
        try {
            for (const name of readdirSync(directory)) {
                if (/^g\+\+-\d+(?:\.\d+)*$/.test(name)) candidates.push(join(directory, name));
            }
        } catch { /* Ignore unreadable PATH entries. */ }
    }
    return candidates.sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
}

export function resolveCppCompiler(command: string): string | undefined {
    if (command.trim() !== 'auto') return resolveExecutable(command);
    const environmentCompiler = process.env.CXX && !/\s/.test(process.env.CXX)
        ? resolveExecutable(process.env.CXX)
        : undefined;
    if (environmentCompiler) return environmentCompiler;
    const versioned = versionedGnuCompilers();
    const commands = process.platform === 'darwin'
        ? [...versioned, 'g++', 'c++', 'clang++']
        : ['g++', ...versioned, 'c++', 'clang++'];
    for (const candidate of commands) {
        const executable = resolveExecutable(candidate);
        if (executable) return executable;
    }
    return undefined;
}

export function buildCppCompilationDatabase(workspace: string, documentPath: string, compiler: string) {
    return [{
        directory: workspace,
        file: documentPath,
        arguments: [compiler, '-std=c++17', '-fsyntax-only', documentPath],
    }];
}

export function isLspLaunchAvailable(language: LspLanguage, settings: LspServerSettings): boolean {
    let launch: LspLaunch;
    try {
        launch = buildLspLaunch(language, join(process.cwd(), `.lsp-check${sep}`), settings);
    } catch {
        return false;
    }
    if (language === 'python' && settings.pyrightCommand.trim() === 'bundled') return true;
    return Boolean(resolveExecutable(launch.command));
}
