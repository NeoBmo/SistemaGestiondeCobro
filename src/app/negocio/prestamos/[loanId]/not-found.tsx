import Link from "next/link";

export default function LoanNotFound() {
  return (
    <>
      <h1 className="text-2xl font-semibold md:text-3xl">Préstamo no encontrado</h1>
      <p className="text-muted mt-2 text-sm">
        El enlace no corresponde a ningún préstamo de tu negocio.
      </p>
      <Link href="/negocio/clientes" className="text-primary mt-4 inline-block underline">
        Volver a los clientes
      </Link>
    </>
  );
}
