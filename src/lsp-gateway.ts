import {
    ConnectionHandler, ForbiddenError, NotFoundError, param, SystemModel, Types,
} from 'hydrooj';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    buildLspLaunch, isLspLaunchAvailable, LspLanguage, LspServerSettings, normalizeLspLanguage,
} from './lsp-launch';
import {
    applyLspContentChanges, encodeLspMessage, JsonRpcMessage, LspFrameDecoder,
} from './lsp-protocol';

interface LspGatewaySettings extends LspServerSettings {
    enabled: boolean;
    maxSessions: number;
    maxSessionsPerUser: number;
    maxDocumentBytes: number;
    idleTimeout: number;
}

const DEFAULT_GATEWAY_SETTINGS: LspGatewaySettings = {
    enabled: true,
    clangdCommand: 'clangd',
    pyrightCommand: 'bundled',
    jdtlsCommand: 'jdtls',
    maxSessions: 8,
    maxSessionsPerUser: 2,
    maxDocumentBytes: 512 * 1024,
    idleTimeout: 5 * 60 * 1000,
};

const CLIENT_METHODS = new Set([
    '$/cancelRequest',
    'initialize',
    'initialized',
    'shutdown',
    'exit',
    'textDocument/didOpen',
    'textDocument/didChange',
    'textDocument/didClose',
    'textDocument/completion',
    'completionItem/resolve',
    'textDocument/signatureHelp',
    'textDocument/hover',
    'textDocument/formatting',
    'workspace/didChangeConfiguration',
]);

let activeSessions = 0;
const userSessions = new Map<number, number>();

function booleanSetting(key: keyof import('hydrooj').SystemKeys, fallback: boolean): boolean {
    const value = SystemModel.get(key);
    return typeof value === 'boolean' ? value : fallback;
}

function numberSetting(key: keyof import('hydrooj').SystemKeys, fallback: number): number {
    const value = SystemModel.get(key);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringSetting(key: keyof import('hydrooj').SystemKeys, fallback: string): string {
    const value = SystemModel.get(key);
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function getLspGatewaySettings(): LspGatewaySettings {
    return {
        enabled: booleanSetting('hydro-batter-code-edit.lspEnabled', DEFAULT_GATEWAY_SETTINGS.enabled),
        clangdCommand: stringSetting('hydro-batter-code-edit.lspClangdCommand', DEFAULT_GATEWAY_SETTINGS.clangdCommand),
        pyrightCommand: stringSetting('hydro-batter-code-edit.lspPyrightCommand', DEFAULT_GATEWAY_SETTINGS.pyrightCommand),
        jdtlsCommand: stringSetting('hydro-batter-code-edit.lspJdtlsCommand', DEFAULT_GATEWAY_SETTINGS.jdtlsCommand),
        maxSessions: numberSetting('hydro-batter-code-edit.lspMaxSessions', DEFAULT_GATEWAY_SETTINGS.maxSessions),
        maxSessionsPerUser: numberSetting('hydro-batter-code-edit.lspMaxSessionsPerUser', DEFAULT_GATEWAY_SETTINGS.maxSessionsPerUser),
        maxDocumentBytes: numberSetting('hydro-batter-code-edit.lspMaxDocumentBytes', DEFAULT_GATEWAY_SETTINGS.maxDocumentBytes),
        idleTimeout: numberSetting('hydro-batter-code-edit.lspIdleTimeout', DEFAULT_GATEWAY_SETTINGS.idleTimeout),
    };
}

export function getAvailableLspLanguages(): LspLanguage[] {
    const settings = getLspGatewaySettings();
    if (!settings.enabled) return [];
    return (['cpp', 'python', 'java'] as LspLanguage[])
        .filter((language) => isLspLaunchAvailable(language, settings));
}

function reserveSession(userId: number, settings: LspGatewaySettings) {
    const currentUserSessions = userSessions.get(userId) || 0;
    if (activeSessions >= settings.maxSessions || currentUserSessions >= settings.maxSessionsPerUser) {
        throw new ForbiddenError('Language server session limit reached');
    }
    activeSessions += 1;
    userSessions.set(userId, currentUserSessions + 1);
}

function releaseSession(userId: number) {
    activeSessions = Math.max(0, activeSessions - 1);
    const remaining = Math.max(0, (userSessions.get(userId) || 1) - 1);
    if (remaining) userSessions.set(userId, remaining);
    else userSessions.delete(userId);
}

export class LspConnectionHandler extends ConnectionHandler {
    category = '#hydro-batter-lsp';
    private language?: LspLanguage;
    private settings?: LspGatewaySettings;
    private server?: ChildProcessWithoutNullStreams;
    private decoder = new LspFrameDecoder();
    private sessionRoot?: string;
    private workspace?: string;
    private documentPath?: string;
    private documentUri?: string;
    private rootUri?: string;
    private idleTimer?: ReturnType<typeof setTimeout>;
    private userId = 0;
    private reserved = false;
    private cleaning = false;
    private stderr = '';
    private documentContent = '';

    @param('language', Types.Name)
    async prepare(domainId: string, rawLanguage: string) {
        this.settings = getLspGatewaySettings();
        this.language = normalizeLspLanguage(rawLanguage);
        if (!this.settings.enabled || !this.language || !isLspLaunchAvailable(this.language, this.settings)) {
            throw new NotFoundError(`LSP:${rawLanguage}`);
        }
        this.userId = Number((this as any).user?._id || 0);
        reserveSession(this.userId, this.settings);
        this.reserved = true;

        this.sessionRoot = await mkdtemp(join(tmpdir(), 'hydro-batter-lsp-'));
        this.workspace = join(this.sessionRoot, 'workspace');
        await mkdir(this.workspace, { recursive: true });
        const launch = buildLspLaunch(this.language, join(this.sessionRoot, 'server-data'), this.settings);
        this.documentPath = join(this.workspace, launch.fileName);
        await writeFile(this.documentPath, '', 'utf8');
        this.documentUri = pathToFileURL(this.documentPath).toString();
        this.rootUri = pathToFileURL(`${this.workspace}${sep}`).toString();

        const environment = { ...process.env };
        delete environment.CLIENT_HOST;
        delete environment.CLIENT_PORT;
        this.server = spawn(launch.command, launch.args, {
            cwd: this.workspace,
            env: environment,
            shell: false,
            stdio: 'pipe',
        });
        this.server.stdout.on('data', (chunk: Buffer) => this.handleServerData(chunk));
        this.server.stderr.on('data', (chunk: Buffer) => {
            this.stderr = `${this.stderr}${chunk.toString('utf8')}`.slice(-4096);
        });
        this.server.on('exit', (code, signal) => {
            if (this.cleaning) return;
            this.sendGateway('stopped', {
                message: `${launch.serverName} stopped (${signal || (code ?? 'unknown')})`,
                detail: this.stderr.trim().split('\n').at(-1) || undefined,
            });
            this.close(4011, `${launch.serverName} stopped`);
        });
        await new Promise<void>((resolve, reject) => {
            this.server!.once('spawn', resolve);
            this.server!.once('error', reject);
        });
        this.touch();
        this.sendGateway('ready', {
            language: this.language,
            server: launch.serverName,
            documentUri: this.documentUri,
            rootUri: this.rootUri,
        });
    }

    private sendGateway(type: string, data: Record<string, unknown> = {}) {
        try {
            this.send({ hydroBatterLsp: { type, ...data } });
        } catch { /* The WebSocket may already be closed. */ }
    }

    private touch() {
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => {
            this.sendGateway('stopped', { message: 'Language server session expired after being idle.' });
            this.close(4008, 'Language server session idle timeout');
        }, this.settings?.idleTimeout || DEFAULT_GATEWAY_SETTINGS.idleTimeout);
        this.idleTimer.unref?.();
    }

    private handleServerData(chunk: Buffer) {
        if (this.cleaning) return;
        try {
            for (const message of this.decoder.push(chunk)) this.send(message);
        } catch (error) {
            this.sendGateway('error', { message: error instanceof Error ? error.message : String(error) });
            this.close(4010, 'Invalid language server response');
        }
    }

    private validateClientMessage(message: JsonRpcMessage): JsonRpcMessage {
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid JSON-RPC message');
        if (!message.method) return message;
        if (!CLIENT_METHODS.has(message.method)) throw new Error(`LSP method is not allowed: ${message.method}`);
        const params = message.params as any;
        const requestedUri = params?.textDocument?.uri;
        if (requestedUri !== undefined && requestedUri !== this.documentUri) throw new Error('Document URI is outside this LSP session');
        if (message.method === 'initialize') {
            return {
                ...message,
                params: {
                    ...(params || {}),
                    processId: null,
                    rootPath: null,
                    rootUri: this.rootUri,
                    workspaceFolders: [{ uri: this.rootUri, name: 'HydroOJ submission' }],
                },
            };
        }
        if (message.method === 'textDocument/didOpen') {
            if (params?.textDocument?.uri !== this.documentUri) throw new Error('Invalid opened document');
            params.textDocument.languageId = this.language;
        }
        return message;
    }

    async message(payload: JsonRpcMessage) {
        this.touch();
        let message: JsonRpcMessage;
        try {
            const serializedBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
            if (serializedBytes > (this.settings?.maxDocumentBytes || DEFAULT_GATEWAY_SETTINGS.maxDocumentBytes) + 64 * 1024) {
                throw new Error('LSP message is too large');
            }
            message = this.validateClientMessage(payload);
            let text: string | undefined;
            if (message.method === 'textDocument/didOpen') {
                const openedText = (message.params as any)?.textDocument?.text;
                if (typeof openedText !== 'string') throw new Error('Opened document is missing text');
                text = openedText;
            } else if (message.method === 'textDocument/didChange') {
                text = applyLspContentChanges(this.documentContent, (message.params as any)?.contentChanges);
            }
            if (text !== undefined) {
                if (Buffer.byteLength(text, 'utf8') > (this.settings?.maxDocumentBytes || DEFAULT_GATEWAY_SETTINGS.maxDocumentBytes)) {
                    throw new Error('Document exceeds the configured LSP size limit');
                }
                if (this.documentPath) await writeFile(this.documentPath, text, 'utf8');
                this.documentContent = text;
            }
        } catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            if (payload?.id !== undefined) {
                this.send({ jsonrpc: '2.0', id: payload.id, error: { code: -32602, message: messageText } });
            } else this.sendGateway('error', { message: messageText });
            return;
        }
        if (!this.server?.stdin.writable) return;
        const frame = encodeLspMessage(message);
        if (!this.server.stdin.write(frame)) {
            const server = this.server;
            await new Promise<void>((resolve) => {
                const finish = () => {
                    server.stdin.off('drain', finish);
                    server.stdin.off('error', finish);
                    server.off('exit', finish);
                    resolve();
                };
                server.stdin.once('drain', finish);
                server.stdin.once('error', finish);
                server.once('exit', finish);
            });
        }
    }

    async cleanup() {
        if (this.cleaning) return;
        this.cleaning = true;
        clearTimeout(this.idleTimer);
        if (this.server) {
            this.server.removeAllListeners('exit');
            this.server.stdin.end();
            if (!this.server.killed) this.server.kill('SIGTERM');
            const child = this.server;
            const forceTimer = setTimeout(() => {
                if (child.exitCode === null) child.kill('SIGKILL');
            }, 2000);
            forceTimer.unref?.();
        }
        try {
            if (this.sessionRoot) await rm(this.sessionRoot, { recursive: true, force: true });
        } catch {
            const sessionRoot = this.sessionRoot;
            const retry = setTimeout(() => {
                if (sessionRoot) void rm(sessionRoot, { recursive: true, force: true });
            }, 2500);
            retry.unref?.();
        } finally {
            if (this.reserved) {
                this.reserved = false;
                releaseSession(this.userId);
            }
        }
    }
}
