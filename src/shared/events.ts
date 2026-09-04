import { EventEmitter } from "node:events";
import type { AgentEvent, EventActor } from "./types.js";

/**
 * One append-only event log for the whole run. Agents and the settlement layer
 * write to it; the frontend reads it over SSE. Nothing reaches the UI except
 * through here, which keeps the three components decoupled.
 */
class EventBus extends EventEmitter {
  private seq = 0;
  private log: AgentEvent[] = [];

  emitEvent(
    actor: EventActor,
    type: string,
    message: string,
    extra: Partial<AgentEvent> = {},
  ): AgentEvent {
    const event: AgentEvent = {
      seq: ++this.seq,
      ts: new Date().toISOString(),
      actor,
      type,
      message,
      ...extra,
    };
    this.log.push(event);
    this.emit("event", event);
    // eslint-disable-next-line no-console
    console.log(`[${actor}] ${message}${event.txHash ? ` (${event.txHash})` : ""}`);
    return event;
  }

  history(): AgentEvent[] {
    return [...this.log];
  }

  reset(): void {
    this.seq = 0;
    this.log = [];
  }
}

export const bus = new EventBus();
