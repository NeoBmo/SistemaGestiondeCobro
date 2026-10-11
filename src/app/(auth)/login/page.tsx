import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PASSWORD_CHANGE_PATH, homePathFor } from "@/modules/identity/page-access";
import { getOptionalPageSession } from "@/modules/identity/page-session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

// Depende de la cookie de sesión de cada petición.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getOptionalPageSession();
  if (session.context) {
    redirect(
      session.context.mustChangePassword ? PASSWORD_CHANGE_PATH : homePathFor(session.context.role),
    );
  }

  // Sin sesión no hay nada que explicar; con una sesión que ya no sirve, se dice por qué.
  const notice = session.denied.code === "UNAUTHENTICATED" ? undefined : session.denied.message;

  return (
    <>
      <h1 className="text-2xl font-semibold md:text-3xl">Iniciar sesión</h1>
      <p className="text-muted mt-2 text-sm">Ingresa con tu usuario y contraseña.</p>
      <LoginForm notice={notice} />
    </>
  );
}
