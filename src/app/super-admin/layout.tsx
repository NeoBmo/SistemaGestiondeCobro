import { getPageSession } from "@/modules/identity/page-session";
import { PrivateShell } from "@/shared/ui/private-shell";

export const dynamic = "force-dynamic";

export default async function SuperAdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getPageSession({ roles: ["SUPER_ADMIN"] });
  return (
    <PrivateShell area="Plataforma" session={session}>
      {children}
    </PrivateShell>
  );
}
