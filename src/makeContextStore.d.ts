import type { ContextMessage } from './actions/context-store/types.js';
type MaybePromise<T> = T | Promise<T>;
export type CompileContextOptions = {
    texts?: readonly string[];
    recentLimit?: number;
    queryLimit?: number;
    limit?: number;
};
export type MakeContextStoreDeps = {
    getCollections: () => MaybePromise<readonly unknown[]>;
    resolveRole?: (meta?: Record<string, unknown>) => ContextMessage['role'];
    resolveDisplayName?: (meta?: Record<string, unknown>) => string | undefined;
    resolveName?: (meta?: Record<string, unknown>) => string | undefined;
    formatTime?: (epochMs: number) => string;
    assistantName?: string;
};
export type MakeContextStoreResult = {
    compileContext: (options?: CompileContextOptions) => Promise<ContextMessage[]>;
};
export declare const makeContextStore: (deps: MakeContextStoreDeps) => MakeContextStoreResult;
export {};
//# sourceMappingURL=makeContextStore.d.ts.map