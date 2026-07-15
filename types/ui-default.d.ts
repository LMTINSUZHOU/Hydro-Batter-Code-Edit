export const $: any;
export const Notification: {
    info(message: string, duration?: number): void;
    warn(message: string, duration?: number): void;
    error(message: string, duration?: number): void;
};
export function i18n(key: string, ...args: unknown[]): string;
export function addPage(page: unknown): void;
export class NamedPage {
    constructor(name: string | string[], callback: (pageName: string) => unknown);
}
export function loadMonaco(features?: string[]): Promise<any>;
