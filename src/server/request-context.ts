import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function enterRequestContext(context: RequestContext): void {
  requestContextStorage.enterWith(context);
}

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}
