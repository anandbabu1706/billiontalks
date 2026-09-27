export type DurableObjectState = {
  storage: {
    get: <T>(key: string) => Promise<T | undefined> | T | undefined;
    put: (key: string, value: unknown) => Promise<void> | void;
    delete: (key: string) => Promise<boolean> | boolean | Promise<void> | void;
  };
};

export class DurableObject {
  public readonly ctx: DurableObjectState;
  public readonly env: unknown;

  constructor(ctx: DurableObjectState, env: unknown) {
    this.ctx = ctx;
    this.env = env;
  }
}
