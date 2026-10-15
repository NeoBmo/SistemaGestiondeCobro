import Link from "next/link";

export default function TicketNotFound() {
  return (
    <>
      <h1 className="text-2xl font-semibold md:text-3xl">Ticket no encontrado</h1>
      <Link href="/super-admin/soporte" className="text-primary mt-4 inline-block underline">
        Volver a soporte
      </Link>
    </>
  );
}
