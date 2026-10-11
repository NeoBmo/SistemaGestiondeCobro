import { getPageSession } from "@/modules/identity/page-session";
import { PrivateShell } from "@/shared/ui/private-shell";

export const dynamic = "force-dynamic";

export default async function CobradorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getPageSession({ roles: ["COBRADOR"] });
  return (
    <PrivateShell area="Cobrador" session={session} widthClass="max-w-lg">
      {children}
    </PrivateShell>
  );
}
