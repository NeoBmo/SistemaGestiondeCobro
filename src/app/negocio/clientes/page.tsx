import type { Metadata } from "next";
import Link from "next/link";
import { getPageSession } from "@/modules/identity/page-session";
import {
  CLIENT_PAGE_SIZE,
  listClients,
  parseClientSearch,
} from "@/modules/portfolio/client-queries";
import { getPool } from "@/shared/database/pg-pool";
import { Alert } from "@/shared/ui/alert";

export const metadata: Metadata = { title: "Clientes" };

const buttonBase =
  "inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-base font-medium";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Los layouts no se vuelven a ejecutar al navegar: cada página protegida comprueba también.
  const session = await getPageSession({ roles: ["ADMIN_NEGOCIO"] });
  const params = await searchParams;
  const search = parseClientSearch(params);
  // Lo pone la ficha tras eliminar un cliente: la confirmación se ve donde termina el recorrido.
  const deleted = params.eliminado === "1";
  const { clients, truncated } = await listClients(getPool(), session, search);

  return (
    <>
      <Link href="/negocio" className="text-primary text-sm underline">
        ← Negocio
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold md:text-3xl">Clientes</h1>
        <Link
          href="/negocio/clientes/nuevo"
          className={`${buttonBase} bg-primary text-primary-foreground border-transparent`}
        >
          Nuevo cliente
        </Link>
      </div>
      {deleted ? (
        <div className="mt-4">
          <Alert variant="success">El cliente fue eliminado.</Alert>
        </div>
      ) : null}

      {/* GET: la búsqueda vive en la URL (se puede compartir y recargar) y no requiere JavaScript. */}
      <form
        method="get"
        aria-label="Buscar clientes"
        className="mt-4 flex flex-wrap items-end gap-3"
      >
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-base font-medium">
          Buscar
          <input
            type="search"
            name="q"
            defaultValue={search ?? ""}
            maxLength={120}
            placeholder="Nombre, sobrenombre, identificación o teléfono"
            className="border-border-strong bg-surface min-h-11 rounded-lg border px-3 font-normal"
          />
        </label>
        <button
          type="submit"
          className={`${buttonBase} border-border-strong bg-surface hover:bg-surface-2`}
        >
          Buscar
        </button>
        {search ? (
          <Link
            href="/negocio/clientes"
            className="text-primary inline-flex min-h-11 items-center underline"
          >
            Quitar búsqueda
          </Link>
        ) : null}
      </form>

      <p className="text-muted mt-4 text-sm">
        {clients.length === 1 ? "1 cliente" : `${clients.length} clientes`}
        {search ? " con esta búsqueda" : ""}
      </p>

      {clients.length === 0 ? (
        <div className="border-border mt-3 rounded-lg border border-dashed p-6 text-center">
          <p className="font-medium">
            {search ? "Ningún cliente coincide con la búsqueda." : "Aún no tienes clientes."}
          </p>
          <p className="text-muted mt-1 text-sm">
            {search
              ? "Prueba con otro nombre o documento."
              : "Crea el primero para poder registrarle un préstamo."}
          </p>
        </div>
      ) : (
        <ul className="mt-3 grid gap-3 lg:grid-cols-2">
          {clients.map((client) => (
            <li key={client.id} className="border-border rounded-lg border p-4">
              <h2 className="text-lg font-medium break-words">
                <Link href={`/negocio/clientes/${client.id}`} className="text-primary underline">
                  {client.name}
                </Link>
                {client.nickname ? (
                  <span className="text-muted font-normal"> · «{client.nickname}»</span>
                ) : null}
              </h2>
              <dl className="text-muted mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                <dt>Identificación</dt>
                <dd className="text-foreground min-w-0 font-mono break-all">
                  {client.identification}
                </dd>
                <dt>Teléfono</dt>
                <dd className="text-foreground min-w-0 break-all">{client.phone ?? "—"}</dd>
                <dt>Préstamos activos</dt>
                <dd className="text-foreground">{client.activeLoans}</dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
      {truncated ? (
        <p className="text-muted mt-3 text-sm">
          Se muestran los primeros {CLIENT_PAGE_SIZE}; afina la búsqueda para ver otros.
        </p>
      ) : null}
    </>
  );
}
