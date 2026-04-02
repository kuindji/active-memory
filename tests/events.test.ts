import { describe, test, expect } from "bun:test";
import { EventEmitter } from "../src/core/events.ts";

describe("EventEmitter", () => {
    test("on and emit deliver events to handler", () => {
        const emitter = new EventEmitter();
        const received: unknown[] = [];

        emitter.on("ingested", (...args) => received.push(...args));
        emitter.emit("ingested", { id: "1" });

        expect(received).toEqual([{ id: "1" }]);
    });

    test("supports multiple listeners for same event", () => {
        const emitter = new EventEmitter();
        let count = 0;

        emitter.on("deleted", () => count++);
        emitter.on("deleted", () => count++);
        emitter.emit("deleted", { memoryId: "1" });

        expect(count).toBe(2);
    });

    test("off removes a specific listener", () => {
        const emitter = new EventEmitter();
        let count = 0;

        const handler = () => count++;
        emitter.on("ingested", handler);
        emitter.emit("ingested");
        expect(count).toBe(1);

        emitter.off("ingested", handler);
        emitter.emit("ingested");
        expect(count).toBe(1); // still 1, not called again
    });

    test("off does nothing for unregistered handler", () => {
        const emitter = new EventEmitter();
        // Should not throw
        emitter.off("ingested", () => {});
    });

    test("off does nothing for unregistered event", () => {
        const emitter = new EventEmitter();
        // Should not throw when event was never registered
        emitter.off("deleted", () => {});
    });

    test("emit does nothing when no listeners registered", () => {
        const emitter = new EventEmitter();
        // Should not throw
        emitter.emit("ingested", { id: "1" });
    });

    test("listener errors are swallowed and do not propagate", () => {
        const emitter = new EventEmitter();
        let secondCalled = false;

        emitter.on("error", () => {
            throw new Error("listener failure");
        });
        emitter.on("error", () => {
            secondCalled = true;
        });

        // Should not throw
        emitter.emit("error", { source: "test" });

        // Second listener should still be called
        expect(secondCalled).toBe(true);
    });

    test("passes multiple arguments to handlers", () => {
        const emitter = new EventEmitter();
        const received: unknown[] = [];

        emitter.on("tagAssigned", (...args) => received.push(...args));
        emitter.emit("tagAssigned", "arg1", "arg2", "arg3");

        expect(received).toEqual(["arg1", "arg2", "arg3"]);
    });

    test("different events are independent", () => {
        const emitter = new EventEmitter();
        let ingestedCount = 0;
        let deletedCount = 0;

        emitter.on("ingested", () => ingestedCount++);
        emitter.on("deleted", () => deletedCount++);

        emitter.emit("ingested");
        expect(ingestedCount).toBe(1);
        expect(deletedCount).toBe(0);

        emitter.emit("deleted");
        expect(ingestedCount).toBe(1);
        expect(deletedCount).toBe(1);
    });
});
