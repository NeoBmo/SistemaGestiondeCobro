import Link from "next/link";

export default function NewLoanNotFound() {
  return (
    <>
      <h1 className="text-2xl font-semibold md:text-3xl">Elige un cliente</h1>
      <p className="text-muted mt-2 text-sm">
        Un préstamo se crea desde la ficha de un cliente de tu negocio.
      </p>
      <Link href="/negocio/clientes" className="text-primary mt-4 inline-block underline">
        Ir a los clientes
      </Link>
    </>
  );
}
