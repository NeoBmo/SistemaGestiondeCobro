import type { Metadata } from "next";
import Link from "next/link";
import { getPageSession } from "@/modules/identity/page-session";
import { ClientForm } from "../_components/client-form";

export const metadata: Metadata = { title: "Nuevo cliente" };

export default async function NewClientPage() {
  await getPageSession({ roles: ["ADMIN_NEGOCIO"] });

  return (
    <>
      <Link href="/negocio/clientes" className="text-primary text-sm underline">
        ← Clientes
      </Link>
      <h1 className="mt-2 text-2xl font-semibold md:text-3xl">Nuevo cliente</h1>
      <ClientForm mode="create" />
    </>
  );
}
