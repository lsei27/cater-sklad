import { EventEmitter } from "node:events";

export type StreamEvent =
  | { type: "reservation_changed"; eventId: string }
  | { type: "ledger_changed"; inventoryItemId: string }
  | { type: "event_status_changed"; eventId: string; status: string }
  | { type: "export_created"; eventId: string; version: number };

class SSEBus {
  private emitter = new EventEmitter();

  on(listener: (ev: StreamEvent) => void) {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  emit(ev: StreamEvent) {
    this.emitter.emit("event", ev);
  }
}

export const sseBus = new SSEBus();

