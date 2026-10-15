import Link from "next/link";

export default function TicketNotFound() {
  return (
    <>
      <h1 className="text-2xl font-semibold md:text-3xl">Ticket no encontrado</h1>
      <p className="text-muted mt-2 text-sm">
        El enlace no corresponde a ningún ticket de tu negocio.
      </p>
      <Link href="/negocio/soporte" className="text-primary mt-4 inline-block underline">
        Volver a soporte
      </Link>
    </>
  );
}
