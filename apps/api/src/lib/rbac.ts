import type { Role } from "../../generated/prisma/client.js";

/// Inventura a přesuny: sklad, admin, nebo uživatel se zapnutým oprávněním.
export function requireStockAccess(user: { role: Role; canStocktake: boolean }) {
  if (user.canStocktake) return;
  requireRole(user.role, ["admin", "warehouse"]);
}

export function requireRole(userRole: Role, allowed: Role[]) {
  if (!allowed.includes(userRole)) {
    const err = new Error("FORBIDDEN");
    // @ts-expect-error attach
    err.statusCode = 403;
    throw err;
  }
}

