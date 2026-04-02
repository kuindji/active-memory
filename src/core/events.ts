import type { MemoryEventName } from "./types.ts";

type EventHandler = (...args: unknown[]) => void;

export class EventEmitter {
    private listeners = new Map<string, Set<EventHandler>>();

    on(event: MemoryEventName, handler: EventHandler): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(handler);
    }

    off(event: MemoryEventName, handler: EventHandler): void {
        this.listeners.get(event)?.delete(handler);
    }

    emit(event: MemoryEventName, ...args: unknown[]): void {
        const handlers = this.listeners.get(event);
        if (!handlers) return;
        for (const handler of handlers) {
            try {
                handler(...args);
            } catch {
                // Prevent listener errors from propagating
            }
        }
    }
}
