import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {getAdminFromToken, SESSION_COOKIE} from "@/lib/server/auth";
import {canUsePasskeys} from "@/lib/server/passkeys";
import PasskeysPanel from "./panel";

export default async function PasskeysPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const admin = token ? await getAdminFromToken(token).catch(() => null) : null;
  if (!admin) redirect("/admin/login?next=/admin/passkeys");
  if (!canUsePasskeys(admin.role)) redirect("/admin");
  return <PasskeysPanel owner={admin.role === "super_admin"}/>;
}
