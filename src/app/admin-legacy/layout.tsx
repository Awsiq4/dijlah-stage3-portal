import type {ReactNode} from "react";

export const dynamic = "force-dynamic";

export default function LegacyAdminLayout({children}: {children: ReactNode}) {
  return children;
}
