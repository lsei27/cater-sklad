import { describe, expect, it } from "vitest";
import { canCreateEventExport, warehouseWorkflowAction } from "../src/lib/viewModel";

describe("akce skladu v detailu akce", () => {
  it("nabidne vyskladneni predane akce", () => {
    expect(warehouseWorkflowAction("SENT_TO_WAREHOUSE")?.label).toBe("Otevřít výdej");
  });

  it("nabidne uzavreni kazde vydane akce", () => {
    expect(warehouseWorkflowAction("ISSUED")?.label).toBe("Zapsat vrácení a uzavřít");
  });

  it("nedava skladovou akci uzavrenym nebo rozpracovanym akcim", () => {
    expect(warehouseWorkflowAction("DRAFT")).toBeNull();
    expect(warehouseWorkflowAction("CLOSED")).toBeNull();
    expect(warehouseWorkflowAction("CANCELLED")).toBeNull();
  });
});

describe("vytvoreni aktualniho exportu", () => {
  it("je dostupne pro editovatelne stavy vcetne jiz predane akce", () => {
    expect(canCreateEventExport("DRAFT")).toBe(true);
    expect(canCreateEventExport("READY_FOR_WAREHOUSE")).toBe(true);
    expect(canCreateEventExport("SENT_TO_WAREHOUSE")).toBe(true);
  });

  it("je zamcene po vydani nebo ukonceni akce", () => {
    expect(canCreateEventExport("ISSUED")).toBe(false);
    expect(canCreateEventExport("CLOSED")).toBe(false);
    expect(canCreateEventExport("CANCELLED")).toBe(false);
  });
});
