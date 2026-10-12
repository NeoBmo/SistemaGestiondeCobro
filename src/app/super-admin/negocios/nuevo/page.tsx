import type { Metadata } from "next";
import Link from "next/link";
import { getPageSession } from "@/modules/identity/page-session";
import { CreateBusinessForm } from "./create-business-form";

export const metadata: Metadata = { title: "Nuevo negocio" };

export default async function NewBusinessPage() {
  // Los layouts no se vuelven a ejecutar al navegar: cada página protegida comprueba también.
  await getPageSession({ roles: ["SUPER_ADMIN"] });

  return (
    <>
      <Link href="/super-admin" className="text-primary text-sm underline">
        ← Negocios
      </Link>
      <h1 className="mt-2 text-2xl font-semibold md:text-3xl">Nuevo negocio</h1>
      <p className="text-muted mt-2 text-sm">
        Crea el negocio con su suscripción y la cuenta de su administrador. La contraseña temporal
        se muestra una sola vez.
      </p>
      <CreateBusinessForm />
    </>
  );
}
