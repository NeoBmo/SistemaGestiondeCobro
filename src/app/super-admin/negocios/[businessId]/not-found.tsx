import Link from "next/link";

export default function BusinessNotFound() {
  return (
    <>
      <h1 className="text-2xl font-semibold md:text-3xl">Negocio no encontrado</h1>
      <p className="text-muted mt-2 text-sm">El enlace no corresponde a ningún negocio.</p>
      <Link href="/super-admin" className="text-primary mt-4 inline-block underline">
        Volver a los negocios
      </Link>
    </>
  );
}
