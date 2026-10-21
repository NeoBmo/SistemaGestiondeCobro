import type { Metadata } from "next";
import { getPageSession } from "@/modules/identity/page-session";
import { PrivateShell } from "@/shared/ui/private-shell";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function NegocioLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getPageSession({ roles: ["ADMIN_NEGOCIO"] });
  return (
    <PrivateShell area="Negocio" session={session}>
      {children}
    </PrivateShell>
  );
}
