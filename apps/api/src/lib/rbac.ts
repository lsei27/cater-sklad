import type { Role } from "@prisma/client";

export function requireRole(userRole: Role, allowed: Role[]) {
  if (!allowed.includes(userRole)) {
    const err = new Error("FORBIDDEN");
    // @ts-expect-error attach
    err.statusCode = 403;
    throw err;
  }
}

