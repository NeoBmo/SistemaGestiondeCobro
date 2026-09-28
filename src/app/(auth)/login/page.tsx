import type { Metadata } from "next";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default function LoginPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold md:text-3xl">Iniciar sesión</h1>
      <p className="text-muted mt-2 text-sm">El acceso se habilita en la fase F1.</p>
    </>
  );
}
