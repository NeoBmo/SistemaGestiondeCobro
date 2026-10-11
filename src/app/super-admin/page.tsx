import type { Metadata } from "next";
import { getPageSession } from "@/modules/identity/page-session";

export const metadata: Metadata = { title: "Plataforma" };

export default async function SuperAdminPage() {
  // Los layouts no se vuelven a ejecutar al navegar: cada página protegida comprueba también.
  await getPageSession({ roles: ["SUPER_ADMIN"] });

  return (
    <>
      <h1 className="text-2xl font-semibold md:text-3xl">Plataforma</h1>
      <p className="text-muted mt-2 text-sm">
        Aún no hay negocios registrados. La gestión de negocios llega en la siguiente entrega.
      </p>
    </>
  );
}
