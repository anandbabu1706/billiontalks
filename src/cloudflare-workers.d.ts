declare module "cloudflare:workers" {
  export type DurableObjectStorage = {
    transaction: <T>(callback: (storage: DurableObjectStorage) => Promise<T>) => Promise<T>;
    get: <T>(key: string) => Promise<T | undefined> | T | undefined;
    put: (key: string, value: unknown) => Promise<void> | void;
    delete: (key: string) => Promise<boolean> | boolean | Promise<void> | void;
  };

  export type DurableObjectState = {
    storage: DurableObjectStorage;
  };

  export abstract class DurableObject<Env = unknown> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Env;

    constructor(ctx: DurableObjectState, env: Env);
  }
}
