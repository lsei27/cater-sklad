import { EventEmitter } from "node:events";

export type StreamEvent =
  | { type: "reservation_changed"; eventId: string }
  | { type: "ledger_changed"; inventoryItemId: string }
  | { type: "event_status_changed"; eventId: string; status: string }
  | { type: "export_created"; eventId: string; version: number };

/**
 * Sběrnice je in-process. Na Renderu běží jedna instance API, takže to stačí.
 * Kdyby se služba škálovala na víc instancí, klienti připojení k jedné instanci
 * by neviděli události vzniklé na druhé — pak je potřeba Postgres LISTEN/NOTIFY
 * nebo Redis, ne tenhle EventEmitter.
 */
class SSEBus {
  private emitter = new EventEmitter();

  constructor() {
    // Každý připojený klient je jeden posluchač. Výchozí strop 10 by od
    // jedenáctého souběžného uživatele sypal do logu MaxListenersExceededWarning.
    this.emitter.setMaxListeners(0);
  }

  on(listener: (ev: StreamEvent) => void) {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  emit(ev: StreamEvent) {
    this.emitter.emit("event", ev);
  }
}

export const sseBus = new SSEBus();

