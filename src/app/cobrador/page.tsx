import type { Metadata } from "next";
import { getPageSession } from "@/modules/identity/page-session";

export const metadata: Metadata = { title: "Cobrador" };

export default async function CobradorPage() {
  await getPageSession({ roles: ["COBRADOR"] });

  return (
    <>
      <h1 className="text-2xl font-semibold md:text-3xl">Cobrador</h1>
      <p className="text-muted mt-2 text-sm">
        Tu cuenta está activa. Tu ruta y tus cobros se habilitan en las siguientes fases.
      </p>
    </>
  );
}
