import type {Queryer} from "./db.ts";
import {isActive, type AdminInfo} from "./rbac.ts";

// Acquire this lock before publication/content locks. A permission change on the
// same account must finish before we authorize, or wait until this write commits.
// The caller's identity is used only as a lookup key; cached roles are not trusted.
export async function lockCurrentContentAdmin(db: Pick<Queryer, "qOne">, adminId: number): Promise<AdminInfo | null> {
  const current = await db.qOne<AdminInfo>(
    `SELECT id,email,role,is_active,status,name,assigned_section,assigned_subjects,perms
     FROM portal_admins WHERE id=$1 FOR UPDATE`, [adminId],
  );
  return current && isActive(current) ? current : null;
}
