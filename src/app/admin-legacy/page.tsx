import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {getAdminFromToken, SESSION_COOKIE} from "@/lib/server/auth";
import Dashboard from "./dashboard";

export default async function AdminPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const admin = token ? await getAdminFromToken(token).catch(() => null) : null;
  if (!admin) redirect("/admin/login?next=/admin-legacy");
  return <Dashboard/>;
}
