import { accessSync, constants } from 'node:fs';
import {
    delimiter, extname, isAbsolute, join, resolve, sep,
} from 'node:path';
import { normalizeLanguage } from './catalog';

export type LspLanguage = 'cpp' | 'python' | 'java';

export interface LspServerSettings {
    clangdCommand: string;
    pyrightCommand: string;
    jdtlsCommand: string;
}

export interface LspLaunch {
    command: string;
    args: string[];
    serverName: 'clangd' | 'Pyright' | 'JDT LS';
    fileName: string;
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

export function isLspLaunchAvailable(language: LspLanguage, settings: LspServerSettings): boolean {
    let launch: LspLaunch;
    try {
        launch = buildLspLaunch(language, join(process.cwd(), `.lsp-check${sep}`), settings);
    } catch {
        return false;
    }
    if (language === 'python' && settings.pyrightCommand.trim() === 'bundled') return true;
    return executableCandidates(launch.command).some((candidate) => {
        try {
            accessSync(candidate, constants.X_OK);
            return true;
        } catch {
            return false;
        }
    });
}
