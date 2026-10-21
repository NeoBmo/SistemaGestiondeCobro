import Link from "next/link";
import type { Metadata } from "next";
import { getPageSession } from "@/modules/identity/page-session";
import { PrivateShell } from "@/shared/ui/private-shell";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const LINKS = [
  ["/super-admin", "Negocios"],
  ["/super-admin/soporte", "Soporte"],
  ["/super-admin/monitoreo", "Monitoreo"],
] as const;

export default async function SuperAdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getPageSession({ roles: ["SUPER_ADMIN"] });
  return (
    <PrivateShell area="Plataforma" session={session}>
      <nav aria-label="Secciones de la plataforma" className="mb-6 flex flex-wrap gap-2">
        {LINKS.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className="border-border bg-background hover:bg-surface inline-flex min-h-11 items-center rounded-lg border px-4 font-medium"
          >
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </PrivateShell>
  );
}
