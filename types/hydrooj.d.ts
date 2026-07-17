export interface SystemKeys {}
export interface UiContextBase {}

export const UiContextBase: Record<string, unknown>;
export const Schema: any;
export const Types: any;
export const PRIV: any;
export const NotFoundError: new (...args: any[]) => Error;
export const ForbiddenError: new (...args: any[]) => Error;
export function param(...args: any[]): any;
export class Handler {
    noCheckPermView: boolean;
    user: { _id: number };
    response: {
        type?: string;
        body?: unknown;
        template?: string | null;
        status?: number;
        addHeader(name: string, value: string): void;
    };
    url(name: string, ...args: Record<string, unknown>[]): string;
    limitRate(operation: string, seconds: number, count: number, key?: string): Promise<void>;
}
export class ConnectionHandler {
    user: { _id: number };
    send(data: unknown): void;
    close(code: number, reason: string): void;
}
export const SystemModel: {
    get<K extends keyof SystemKeys>(key: K): SystemKeys[K] | undefined;
};
export const SettingModel: {
    langs: Record<string, {
        disabled?: boolean;
        hidden?: boolean;
        remote?: boolean;
        display?: string;
        monaco?: string;
        highlight?: string;
        compile?: string;
        execute?: string;
    }>;
};
export const TaskModel: {
    add(task: Record<string, unknown> & { type: string }): Promise<unknown>;
    deleteMany(query: Record<string, unknown>): Promise<unknown>;
};
export type Context = any;
