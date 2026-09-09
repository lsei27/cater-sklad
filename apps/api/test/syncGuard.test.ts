import { describe, expect, it } from "vitest";
import { decideSyncExecution } from "../src/lib/syncGuard.js";

const LOCAL = "postgresql://cater:cater@localhost:5432/cater_sklad?schema=public";
const PROD = "postgresql://postgres:tajne@db.abcdefgh.supabase.co:5432/postgres";

describe("decideSyncExecution", () => {
  it("bez prepinace nic nezapisuje, i na lokalni databazi", () => {
    const d = decideSyncExecution({ databaseUrl: LOCAL, argv: [] });
    expect(d.apply).toBe(false);
    expect(d.host).toBe("localhost");
  });

  it("--apply projde na lokalni databazi", () => {
    const d = decideSyncExecution({ databaseUrl: LOCAL, argv: ["--apply"] });
    expect(d.apply).toBe(true);
  });

  it("--apply na vzdalenou databazi neprojde", () => {
    const d = decideSyncExecution({ databaseUrl: PROD, argv: ["--apply"] });
    expect(d.apply).toBe(false);
    expect(d.reason).toContain("db.abcdefgh.supabase.co");
  });

  it("vzdalena databaze projde jen po vypsani presneho hostitele", () => {
    const d = decideSyncExecution({
      databaseUrl: PROD,
      argv: ["--apply", "--allow-remote-write=db.abcdefgh.supabase.co"]
    });
    expect(d.apply).toBe(true);
  });

  it("nesouhlasici hostitel v potvrzeni neprojde", () => {
    const d = decideSyncExecution({
      databaseUrl: PROD,
      argv: ["--apply", "--allow-remote-write=localhost"]
    });
    expect(d.apply).toBe(false);
    expect(d.reason).toContain("nesouhlasí");
  });

  it("potvrzeni hostitele bez --apply porad jen zkousi nanecisto", () => {
    const d = decideSyncExecution({
      databaseUrl: PROD,
      argv: ["--allow-remote-write=db.abcdefgh.supabase.co"]
    });
    expect(d.apply).toBe(false);
  });

  it("--dry-run zustava funkcni jako vyslovne nanecisto", () => {
    const d = decideSyncExecution({ databaseUrl: LOCAL, argv: ["--dry-run", "--apply"] });
    expect(d.apply).toBe(false);
  });

  it("nesmyslna DATABASE_URL nikdy nezapisuje", () => {
    const d = decideSyncExecution({ databaseUrl: "neni-url", argv: ["--apply"] });
    expect(d.apply).toBe(false);
  });

  it("hostitele v docker-compose bere jako lokalni", () => {
    for (const host of ["127.0.0.1", "db", "host.docker.internal"]) {
      const d = decideSyncExecution({
        databaseUrl: `postgresql://cater:cater@${host}:5432/cater_sklad`,
        argv: ["--apply"]
      });
      expect(d.apply, host).toBe(true);
    }
  });

  it("nikdy nevraci heslo v popisu cile", () => {
    const d = decideSyncExecution({ databaseUrl: PROD, argv: ["--apply"] });
    expect(JSON.stringify(d)).not.toContain("tajne");
  });
});
