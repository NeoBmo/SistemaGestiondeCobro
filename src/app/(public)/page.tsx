import Link from "next/link";
import {
  PLAN_CATALOG,
  collectorsLabel,
  dashboardLabel,
  discountPercent,
} from "@/modules/subscriptions/plan-catalog";
import { formatMoney } from "@/shared/money/money";

const QUESTIONS = [
  "Cuánto dinero se prestó, se recibió, se gastó y permanece en movimiento.",
  "Qué clientes deben, cuánto deben y con qué nivel de cumplimiento.",
  "Qué debe cobrar cada cobrador y qué dinero administra.",
  "Qué ocurrió, cuándo, quién lo hizo y sobre qué operación.",
];

export default function LandingPage() {
  return (
    <>
      <section aria-labelledby="titulo" className="flex flex-col gap-4">
        <h1 id="titulo" className="text-4xl font-bold md:text-5xl">
          Cuadre
        </h1>
        <p className="max-w-2xl text-base">
          Gestión de cobros para negocios que prestan dinero y cobran cuotas mediante cobradores:
          cartera, cajas, cobradores y trazabilidad financiera completa, en un solo lugar.
        </p>
        <div>
          <Link
            href="/login"
            className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-lg px-5 text-base font-medium"
          >
            Iniciar sesión
          </Link>
        </div>
      </section>

      <section aria-labelledby="preguntas" className="mt-12 flex flex-col gap-3">
        <h2 id="preguntas" className="text-xl font-semibold">
          Respuestas con datos verificables
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {QUESTIONS.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ul>
        <p className="text-muted text-sm">
          Nada se edita ni se borra: cada corrección es un movimiento nuevo con su motivo.
        </p>
      </section>

      <section aria-labelledby="planes" className="mt-12 flex flex-col gap-4">
        <h2 id="planes" className="text-xl font-semibold">
          Planes
        </h2>
        <p className="text-muted text-sm">
          Todos incluyen cartera, cobros, cajas y liquidaciones. Precios en pesos colombianos.
        </p>
        <ul className="grid gap-4 md:grid-cols-3">
          {PLAN_CATALOG.map((plan) => (
            <li
              key={plan.code}
              className={`flex flex-col gap-2 rounded-lg p-4 ${
                plan.recommended ? "border-primary border-2" : "border-border border"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-medium">{plan.name}</h3>
                {plan.recommended && (
                  <span className="border-primary bg-primary-subtle text-foreground inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-xs font-medium">
                    <span aria-hidden="true">★</span>
                    Recomendado
                  </span>
                )}
              </div>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-2xl font-semibold tabular-nums">
                  {formatMoney(plan.priceAmount)}
                </span>
                <span className="text-muted text-sm">{plan.pricePeriod}</span>
              </p>
              {plan.referencePriceAmount !== null && (
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  {/* <del> no se anuncia en la mayoría de lectores: el texto visible da el sentido. */}
                  <span className="text-muted">
                    Sin descuento:{" "}
                    <del className="font-mono tabular-nums">
                      {formatMoney(plan.referencePriceAmount)}
                    </del>
                  </span>
                  <span className="border-success bg-success-subtle text-success-strong rounded-sm border px-2 py-1 text-xs font-medium">
                    Ahorras {discountPercent(plan.priceAmount, plan.referencePriceAmount)} %
                  </span>
                </p>
              )}
              <ul className="flex flex-col gap-1 text-base">
                <li>Vigencia: {plan.validity}</li>
                <li>{collectorsLabel(plan.maxActiveCollectors)}</li>
                <li>{dashboardLabel(plan.dashboardConfigurable)}</li>
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
