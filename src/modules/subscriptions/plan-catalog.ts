import type { PlanCode } from "./plans";

/**
 * Lo que la landing muestra de cada plan (01-CONTEXTO, «Planes»). Es contenido comercial estático: no
 * lleva precios en pesos (las cifras reales siguen pendientes, 05-PENDIENTES) y no consulta la BD, para
 * que la página pública funcione sin ella. Una prueba de integración comprueba que `maxActiveCollectors`
 * y `dashboardConfigurable` coinciden con la tabla `plans`.
 */
export type PlanCatalogEntry = {
  code: PlanCode;
  name: string;
  validity: string;
  maxActiveCollectors: number | null;
  dashboardConfigurable: boolean;
  relativePrice: string;
};

export const PLAN_CATALOG: readonly PlanCatalogEntry[] = [
  {
    code: "SEMANAL",
    name: "Semanal",
    validity: "7 días",
    maxActiveCollectors: 5,
    dashboardConfigurable: false,
    relativePrice: "Precio base",
  },
  {
    code: "MENSUAL",
    name: "Mensual",
    validity: "1 mes",
    maxActiveCollectors: null,
    dashboardConfigurable: true,
    relativePrice: "Precio estándar",
  },
  {
    code: "ANUAL",
    name: "Anual",
    validity: "1 año",
    maxActiveCollectors: null,
    dashboardConfigurable: true,
    relativePrice: "20 % menos que 12 mensualidades",
  },
];

/** «Hasta 5 cobradores activos» o «Cobradores sin límite práctico». */
export function collectorsLabel(max: number | null): string {
  return max === null ? "Cobradores sin límite práctico" : `Hasta ${max} cobradores activos`;
}

export function dashboardLabel(configurable: boolean): string {
  return configurable ? "Dashboard configurable" : "Dashboard predeterminado";
}
