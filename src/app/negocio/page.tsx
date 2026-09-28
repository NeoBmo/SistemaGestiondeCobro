import type { Metadata } from "next";

export const metadata: Metadata = { title: "Negocio" };

export default function NegocioPage() {
  return <h1 className="text-2xl font-semibold md:text-3xl">Negocio</h1>;
}
