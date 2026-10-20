import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageSession } from "@/modules/identity/page-session";
import { getBusinessDetail } from "@/modules/subscriptions/business-queries";
import { ACCESS_LABEL, STATUS_PRESENTATION } from "@/modules/subscriptions/status-presentation";
import { getPool } from "@/shared/database/pg-pool";
import { formatDateTimeInZone, formatIsoDate } from "@/shared/dates/dates";
import { BusinessActions } from "../../_components/business-actions";
import { StatusBadge } from "../../_components/status-badge";

export const metadata: Metadata = { title: "Negocio" };

const ADMIN_STATUS_LABEL = {
  ACTIVO: "Activo",
  BLOQUEADO: "Bloqueado",
  PENDIENTE_CAMBIO_CONTRASENA: "Pendiente de cambiar la contraseña temporal",
} as const;

export default async function BusinessPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  // Los layouts no se vuelven a ejecutar al navegar: cada página protegida comprueba también.
  const session = await getPageSession({ roles: ["SUPER_ADMIN"] });
  const { businessId } = await params;
  const business = await getBusinessDetail(getPool(), session, businessId);
  if (!business) notFound();

  return (
    <>
      <Link href="/super-admin" className="text-primary text-sm underline">
        ← Negocios
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold break-words md:text-3xl">{business.name}</h1>
        <StatusBadge status={business.status} />
      </div>
      <p className="text-muted mt-1 text-sm">{ACCESS_LABEL[business.accessStatus]}</p>
      {business.status === "VENCIDA" ? (
        <p className="text-muted mt-1 text-sm">
          La suscripción está vencida; es informativo y no bloquea el acceso del negocio.
        </p>
      ) : null}

      <section aria-labelledby="datos" className="mt-6">
        <h2 id="datos" className="text-xl font-semibold">
          Datos
        </h2>
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-base">
          <dt className="text-muted">Responsable</dt>
          <dd className="min-w-0 break-words">{business.ownerName}</dd>
          <dt className="text-muted">Identificación</dt>
          <dd className="min-w-0 break-all">{business.ownerIdentification}</dd>
          <dt className="text-muted">Teléfono</dt>
          <dd className="min-w-0 break-all">{business.phone}</dd>
          <dt className="text-muted">Zona horaria</dt>
          <dd>{business.timeZone}</dd>
          <dt className="text-muted">Administrador</dt>
          <dd className="min-w-0 break-words">
            {business.admin
              ? `${business.admin.displayName} (${business.admin.username}) · ${ADMIN_STATUS_LABEL[business.admin.status]}`
              : "Sin cuenta administrativa"}
          </dd>
          {business.admin ? (
            <>
              <dt className="text-muted">Último ingreso</dt>
              <dd>
                {business.admin.lastSignInAt
                  ? formatDateTimeInZone(business.admin.lastSignInAt, business.timeZone)
                  : "Aún no ha ingresado"}
              </dd>
            </>
          ) : null}
        </dl>
      </section>

      <section aria-labelledby="historial" className="mt-8">
        <h2 id="historial" className="text-xl font-semibold">
          Historial de suscripciones
        </h2>
        <ol className="mt-2 flex flex-col gap-3">
          {business.subscriptions.map((subscription) => (
            <li key={subscription.id} className="border-border rounded-lg border p-3 text-sm">
              <p className="font-medium">
                Plan {subscription.planName} ·{" "}
                {STATUS_PRESENTATION[subscription.status].label.toLowerCase()}
              </p>
              <p className="text-muted">
                Del {formatIsoDate(subscription.startsOn)} al{" "}
                {formatIsoDate(subscription.expiresOn)}
                {subscription.changedBy ? ` · registrada por ${subscription.changedBy}` : ""}
              </p>
              {subscription.note ? <p className="mt-1">{subscription.note}</p> : null}
            </li>
          ))}
        </ol>
      </section>

      <BusinessActions
        businessId={business.id}
        currentStatus={business.currentStatus}
        currentPlan={business.currentPlan}
        adminUsername={business.admin?.username ?? null}
      />
    </>
  );
}
