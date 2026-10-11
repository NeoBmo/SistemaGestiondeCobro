import type { Metadata } from "next";
import { getPageSession } from "@/modules/identity/page-session";

export const metadata: Metadata = { title: "Negocio" };

export default async function NegocioPage() {
  await getPageSession({ roles: ["ADMIN_NEGOCIO"] });

  return (
    <>
      <h1 className="text-2xl font-semibold md:text-3xl">Negocio</h1>
      <p className="text-muted mt-2 text-sm">
        Tu cuenta está activa. Clientes, préstamos y cajas se habilitan en las siguientes fases.
      </p>
    </>
  );
}
