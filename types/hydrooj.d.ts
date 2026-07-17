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
    response: {
        type?: string;
        body?: unknown;
        addHeader(name: string, value: string): void;
    };
}
export class ConnectionHandler {
    user: { _id: number };
    send(data: unknown): void;
    close(code: number, reason: string): void;
}
export const SystemModel: {
    get<K extends keyof SystemKeys>(key: K): SystemKeys[K] | undefined;
};
export type Context = any;
