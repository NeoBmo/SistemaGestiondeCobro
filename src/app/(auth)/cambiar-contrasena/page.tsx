import type { Metadata } from "next";
import { homePathFor } from "@/modules/identity/page-access";
import { getPageSession } from "@/modules/identity/page-session";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Cambiar contraseña" };

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  // Solo la ve quien tiene la contraseña temporal pendiente; los demás vuelven a su área.
  const session = await getPageSession({ requirePasswordChangePending: true });

  return (
    <>
      <h1 className="text-2xl font-semibold md:text-3xl">Cambia tu contraseña</h1>
      <p className="text-muted mt-2 text-sm">
        Hola, {session.displayName}. Tu contraseña es temporal: elige una nueva para continuar.
      </p>
      <ChangePasswordForm homePath={homePathFor(session.role)} />
    </>
  );
}
