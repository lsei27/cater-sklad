// syncFromExcel.ts zapisuje do inventare a do ledgeru. Bezi rucne pres tsx a
// DATABASE_URL bere z .env, ktery miri na produkcni Supabase - spustit ho
// omylem znamenalo sahnout rovnou na ostra data.
//
// Proto: nanecisto je vychozi stav a ostry beh na vzdalene databazi vyzaduje
// vypsat jeji hostitele rukou.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "db", "host.docker.internal"]);

export type SyncDecision = {
  apply: boolean;
  host: string;
  database: string;
  isLocal: boolean;
  reason?: string;
};

export function decideSyncExecution(params: { databaseUrl: string; argv: string[] }): SyncDecision {
  const { databaseUrl, argv } = params;

  let host: string;
  let database: string;
  try {
    const url = new URL(databaseUrl);
    host = url.hostname;
    database = url.pathname.replace(/^\//, "") || "(neznámá)";
  } catch {
    return {
      apply: false,
      host: "(nečitelná DATABASE_URL)",
      database: "(neznámá)",
      isLocal: false,
      reason: "DATABASE_URL se nepodařilo přečíst."
    };
  }

  const isLocal = LOCAL_HOSTS.has(host);
  const wantsApply = argv.includes("--apply");
  const forcedDryRun = argv.includes("--dry-run");
  const remoteAck = argv
    .find((a) => a.startsWith("--allow-remote-write="))
    ?.slice("--allow-remote-write=".length);

  const base = { host, database, isLocal };

  if (forcedDryRun) {
    return { ...base, apply: false, reason: "Spuštěno s --dry-run." };
  }
  if (!wantsApply) {
    return { ...base, apply: false, reason: "Chybí --apply, takže se jen zkouší nanečisto." };
  }
  if (isLocal) {
    return { ...base, apply: true };
  }
  if (!remoteAck) {
    return {
      ...base,
      apply: false,
      reason:
        `Cíl "${host}" není lokální databáze. Pro zápis do něj přidej ` +
        `--allow-remote-write=${host}`
    };
  }
  if (remoteAck !== host) {
    return {
      ...base,
      apply: false,
      reason: `Potvrzený hostitel "${remoteAck}" nesouhlasí s cílem "${host}".`
    };
  }
  return { ...base, apply: true };
}
