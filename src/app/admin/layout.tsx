import type {ReactNode} from "react";

// Each administrative page uses a per-response CSP nonce.
export const dynamic = "force-dynamic";

export default function AdminLayout({children}: {children: ReactNode}) {
  return children;
}
