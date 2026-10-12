import Link from "next/link";

export default function ClientNotFound() {
  return (
    <>
      <h1 className="text-2xl font-semibold md:text-3xl">Cliente no encontrado</h1>
      <p className="text-muted mt-2 text-sm">
        El enlace no corresponde a ningún cliente de tu negocio.
      </p>
      <Link href="/negocio/clientes" className="text-primary mt-4 inline-block underline">
        Volver a los clientes
      </Link>
    </>
  );
}
