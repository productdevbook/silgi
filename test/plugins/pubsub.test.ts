import { describe, it, expect } from "vitest";
import { createPublisher, MemoryPubSub } from "#src/plugins/pubsub.ts";

describe("PubSub", () => {
  it("MemoryPubSub publishes and subscribes", async () => {
    const backend = new MemoryPubSub();
    const received: unknown[] = [];

    const unsub = backend.subscribe("test", (data) => received.push(data));

    await backend.publish("test", { id: 1 });
    await backend.publish("test", { id: 2 });

    expect(received).toEqual([{ id: 1 }, { id: 2 }]);

    unsub();

    await backend.publish("test", { id: 3 });
    expect(received).toHaveLength(2); // no more events after unsubscribe
  });

  it("createPublisher.publish dispatches to backend", async () => {
    const backend = new MemoryPubSub();
    const pubsub = createPublisher(backend);
    const received: unknown[] = [];

    backend.subscribe("ch", (data) => received.push(data));
    await pubsub.publish("ch", "hello");

    expect(received).toEqual(["hello"]);
  });
});
