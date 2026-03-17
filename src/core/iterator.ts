/**
 * Async iterator utilities for streaming support.
 */

import { sequential } from "./utils.ts";

type CleanupReason = "return" | "throw" | "next" | "dispose";

export class AsyncIteratorClass<TYield, TReturn = void>
  implements AsyncGenerator<TYield, TReturn>
{
  #nextFn: () => Promise<IteratorResult<TYield, TReturn>>;
  #cleanup?: (reason: CleanupReason) => Promise<void>;
  #isDone = false;
  #cleanupCalled = false;

  constructor(
    nextFn: () => Promise<IteratorResult<TYield, TReturn>>,
    cleanup?: (reason: CleanupReason) => Promise<void>,
  ) {
    this.#nextFn = sequential(nextFn);
    this.#cleanup = cleanup;
  }

  async #doCleanup(reason: CleanupReason): Promise<void> {
    if (this.#cleanupCalled) return;
    this.#cleanupCalled = true;
    await this.#cleanup?.(reason);
  }

  async next(): Promise<IteratorResult<TYield, TReturn>> {
    if (this.#isDone) return { done: true, value: undefined as TReturn };
    try {
      const result = await this.#nextFn();
      if (result.done) {
        this.#isDone = true;
        await this.#doCleanup("next");
      }
      return result;
    } catch (error) {
      this.#isDone = true;
      await this.#doCleanup("throw");
      throw error;
    }
  }

  async return(value?: TReturn): Promise<IteratorResult<TYield, TReturn>> {
    this.#isDone = true;
    await this.#doCleanup("return");
    return { done: true, value: value as TReturn };
  }

  async throw(error?: unknown): Promise<IteratorResult<TYield, TReturn>> {
    this.#isDone = true;
    await this.#doCleanup("throw");
    throw error;
  }

  [Symbol.asyncIterator](): this { return this; }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#isDone = true;
    await this.#doCleanup("dispose");
  }
}

export function mapAsyncIterator<TIn, TOut, TReturn = void>(
  source: AsyncIterableIterator<TIn>,
  transform: (value: TIn) => Promise<TOut> | TOut,
  transformError?: (error: unknown) => unknown,
): AsyncIteratorClass<TOut, TReturn> {
  return new AsyncIteratorClass<TOut, TReturn>(
    async () => {
      try {
        const result = await source.next();
        if (result.done) {
          return { done: true, value: (await transform(result.value as unknown as TIn)) as unknown as TReturn };
        }
        return { done: false, value: await transform(result.value) };
      } catch (error) {
        throw transformError ? transformError(error) : error;
      }
    },
    async () => { await source.return?.(); },
  );
}

export function iteratorToStream<T>(iterator: AsyncIterableIterator<T>): ReadableStream<T> {
  return new ReadableStream<T>({
    async pull(controller) {
      const { done, value } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel() { iterator.return?.(); },
  });
}

export function streamToIterator<T>(stream: ReadableStream<T>): AsyncIteratorClass<T> {
  const reader = stream.getReader();
  return new AsyncIteratorClass<T>(
    async () => {
      const { done, value } = await reader.read();
      if (done) return { done: true, value: undefined as T };
      return { done: false, value };
    },
    async () => { reader.releaseLock(); await stream.cancel(); },
  );
}
