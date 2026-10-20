
> cuadre@0.0.0 report:code-hotspots
> node scripts/report-code-hotspots.mjs

# Hotspots TypeScript (umbral de observación: >400 líneas/archivo, >80 líneas/función)

Archivos de producto: 239; archivos de prueba: 114.

## Archivos sobre el umbral

- src/tests/integration/cash-sessions-schema.test.ts — 817 líneas (test)
- src/tests/integration/business-lifecycle.test.ts — 685 líneas (test)
- src/tests/integration/payments-schema.test.ts — 677 líneas (test)
- src/tests/integration/cash-ledger-schema.test.ts — 602 líneas (test)
- src/tests/integration/payments.test.ts — 539 líneas (test)
- src/tests/integration/sessions.test.ts — 533 líneas (test)
- src/tests/integration/collectors-schema.test.ts — 504 líneas (test)
- src/tests/integration/run-cash-command.test.ts — 492 líneas (test)
- src/modules/portfolio/payments.ts — 479 líneas
- src/tests/integration/reset-admin-password.test.ts — 479 líneas (test)
- src/tests/integration/collectors.test.ts — 473 líneas (test)
- src/tests/integration/refinancing.test.ts — 459 líneas (test)
- src/tests/integration/portfolio-schema.test.ts — 458 líneas (test)
- src/tests/integration/late-fees.test.ts — 451 líneas (test)
- src/tests/integration/dashboard.test.ts — 444 líneas (test)
- src/modules/portfolio/contracts.ts — 433 líneas
- src/tests/integration/settlements.test.ts — 427 líneas (test)
- src/tests/integration/cash-sessions-hardening.test.ts — 401 líneas (test)
- src/tests/integration/create-business.test.ts — 401 líneas (test)

## Funciones sobre el umbral

- src/tests/integration/create-business.test.ts — <anónima>: 322 líneas (test)
- src/tests/integration/refinancing.test.ts — <anónima>: 292 líneas (test)
- src/app/negocio/prestamos/importar/import-loan-form.tsx — ImportLoanForm: 290 líneas
- src/app/negocio/prestamos/_components/refinance-loan.tsx — RefinanceLoan: 265 líneas
- src/app/negocio/prestamos/nuevo/loan-form.tsx — LoanForm: 259 líneas
- src/app/negocio/prestamos/[loanId]/page.tsx — LoanPage: 243 líneas
- src/tests/integration/collectors.test.ts — <anónima>: 225 líneas (test)
- src/modules/portfolio/refinancing.ts — refinanceLoan: 213 líneas
- src/tests/integration/contracts.test.ts — <anónima>: 210 líneas (test)
- src/tests/integration/cash-sessions-schema.test.ts — <anónima>: 209 líneas (test)
- src/modules/portfolio/payments.ts — runRegisterPayment: 206 líneas
- src/tests/integration/login.test.ts — <anónima>: 204 líneas (test)
- src/modules/portfolio/refinancing.ts — execute: 199 líneas
- src/app/negocio/cartera/page.tsx — PortfolioPage: 196 líneas
- src/modules/portfolio/loan-queries.ts — getLoanDetail: 190 líneas
- src/modules/portfolio/payments.ts — execute: 187 líneas
- src/app/negocio/prestamos/_components/register-payment.tsx — RegisterPayment: 183 líneas
- src/tests/integration/cash-sessions-schema.test.ts — <anónima>: 180 líneas (test)
- src/tests/integration/annul-contract.test.ts — <anónima>: 175 líneas (test)
- src/tests/integration/payments.test.ts — <anónima>: 173 líneas (test)
- src/tests/integration/collectors.test.ts — <anónima>: 166 líneas (test)
- src/tests/integration/reset-admin-password.test.ts — <anónima>: 166 líneas (test)
- src/app/negocio/_components/command-form.tsx — CommandForm: 164 líneas
- src/app/api/super-admin/businesses/[businessId]/[action]/route.test.ts — <anónima>: 163 líneas (test)
- src/tests/integration/import-loan.test.ts — <anónima>: 163 líneas (test)
- src/tests/integration/payments.test.ts — <anónima>: 156 líneas (test)
- src/app/cobrador/clientes/[clientId]/page.tsx — CollectorClientPage: 152 líneas
- src/app/negocio/clientes/[clientId]/page.tsx — ClientPage: 152 líneas
- src/app/super-admin/monitoreo/page.tsx — MonitoringPage: 151 líneas
- src/tests/integration/collectors-concurrency.test.ts — <anónima>: 150 líneas (test)
- src/tests/integration/identity-rls.test.ts — <anónima>: 149 líneas (test)
- src/tests/integration/settlements.test.ts — <anónima>: 147 líneas (test)
- src/tests/integration/business-lifecycle.test.ts — <anónima>: 144 líneas (test)
- src/tests/integration/payments-schema.test.ts — <anónima>: 144 líneas (test)
- src/modules/portfolio/contracts.ts — annulContract: 143 líneas
- src/modules/portfolio/contracts.ts — confirmContract: 142 líneas
- src/modules/dashboard/queries.ts — getDashboard: 141 líneas
- src/tests/integration/portfolio-schema.test.ts — <anónima>: 141 líneas (test)
- src/tests/integration/sessions.test.ts — <anónima>: 140 líneas (test)
- src/modules/collections/settlements.ts — confirmSettlement: 139 líneas
- src/tests/integration/access-token-hook.test.ts — <anónima>: 137 líneas (test)
- src/tests/integration/payments-schema.test.ts — <anónima>: 137 líneas (test)
- src/app/negocio/clientes/_components/client-form.tsx — ClientForm: 135 líneas
- src/tests/integration/support-schema.test.ts — <anónima>: 135 líneas (test)
- src/tests/integration/cash-ledger-schema.test.ts — <anónima>: 134 líneas (test)
- src/modules/portfolio/contracts.ts — execute: 130 líneas
- src/app/super-admin/page.tsx — SuperAdminPage: 129 líneas
- src/tests/integration/cash-ledger-schema.test.ts — <anónima>: 129 líneas (test)
- src/modules/portfolio/contracts.ts — execute: 128 líneas
- src/app/negocio/caja/_components/cash-actions.tsx — MovementForm: 127 líneas
- src/modules/collections/settlements.ts — execute: 126 líneas
- src/tests/integration/cash-sessions-hardening.test.ts — <anónima>: 124 líneas (test)
- src/modules/portfolio/imports.ts — importLoan: 123 líneas
- src/tests/integration/collectors-schema.test.ts — <anónima>: 123 líneas (test)
- src/app/negocio/_components/dashboard-settings.tsx — DashboardSettings: 122 líneas
- src/app/cobrador/page.tsx — CobradorPage: 121 líneas
- src/app/super-admin/negocios/nuevo/create-business-form.tsx — CreateBusinessForm: 118 líneas
- src/app/negocio/caja/page.tsx — CajaMayorPage: 117 líneas
- src/app/super-admin/_components/business-actions.tsx — BusinessActions: 115 líneas
- src/tests/integration/late-fees.test.ts — <anónima>: 115 líneas (test)
- src/tests/integration/portfolio-overview.test.ts — <anónima>: 113 líneas (test)
- src/app/super-admin/_components/business-actions.tsx — ActionForm: 110 líneas
- src/tests/integration/cash-sessions-schema.test.ts — <anónima>: 110 líneas (test)
- src/modules/collections/collector-queries.ts — getCollectorHome: 109 líneas
- src/modules/collections/collector-queries.ts — getCollectorClient: 109 líneas
- src/modules/portfolio/imports.ts — execute: 109 líneas
- src/tests/integration/tickets.test.ts — <anónima>: 109 líneas (test)
- src/app/negocio/clientes/page.tsx — ClientsPage: 108 líneas
- src/app/negocio/jornadas/page.tsx — SessionsPage: 108 líneas
- src/tests/integration/annul-contract-guards.test.ts — <anónima>: 108 líneas (test)
- src/app/(auth)/cambiar-contrasena/change-password-form.tsx — ChangePasswordForm: 106 líneas
- src/app/api/negocio/caja/[command]/route.test.ts — <anónima>: 106 líneas (test)
- src/tests/integration/collectors-schema.test.ts — <anónima>: 106 líneas (test)
- src/app/super-admin/soporte/page.tsx — SupportPage: 105 líneas
- src/modules/portfolio/payments.ts — reversePayment: 105 líneas
- src/tests/integration/reset-admin-password.test.ts — <anónima>: 105 líneas (test)
- src/tests/integration/cash-commands.test.ts — <anónima>: 102 líneas (test)
- src/tests/integration/contracts-guards.test.ts — <anónima>: 102 líneas (test)
- src/tests/integration/monitoring.test.ts — <anónima>: 101 líneas (test)
- src/modules/dashboard/portfolio.ts — listPortfolio: 100 líneas
- src/app/negocio/prestamos/_components/payment-history.tsx — ReversePayment: 99 líneas
- src/tests/integration/business-lifecycle.test.ts — <anónima>: 98 líneas (test)
- src/tests/integration/create-super-admin.test.ts — <anónima>: 98 líneas (test)
- src/app/negocio/caja/_components/reverse-movement.tsx — ReverseMovement: 97 líneas
- src/modules/subscriptions/create-business.ts — createBusiness: 97 líneas
- src/tests/integration/payments.test.ts — <anónima>: 97 líneas (test)
- src/tests/integration/identity-schema.test.ts — <anónima>: 96 líneas (test)
- src/tests/integration/portfolio-schema.test.ts — <anónima>: 96 líneas (test)
- src/app/api/super-admin/businesses/route.test.ts — <anónima>: 95 líneas (test)
- src/modules/monitoring/indicators.ts — getPlatformIndicators: 94 líneas
- src/tests/e2e/collections.spec.ts — <anónima>: 94 líneas (test)
- src/tests/integration/append-only.test.ts — <anónima>: 94 líneas (test)
- src/tests/integration/dashboard.test.ts — <anónima>: 94 líneas (test)
- src/app/negocio/prestamos/_components/annul-loan.tsx — AnnulLoan: 93 líneas
- src/tests/e2e/payments.spec.ts — <anónima>: 93 líneas (test)
- src/tests/integration/dashboard.test.ts — <anónima>: 93 líneas (test)
- src/tests/integration/run-cash-command.test.ts — <anónima>: 93 líneas (test)
- src/modules/portfolio/payments.ts — execute: 92 líneas
- src/tests/integration/password-change-hardening.test.ts — <anónima>: 92 líneas (test)
- src/tests/integration/business-lifecycle.test.ts — <anónima>: 91 líneas (test)
- src/tests/integration/helpers/auth.ts — purge: 91 líneas
- src/tests/integration/portfolio-overview.test.ts — <anónima>: 91 líneas (test)
- src/app/negocio/page.tsx — NegocioPage: 90 líneas
- src/app/super-admin/negocios/[businessId]/page.tsx — BusinessPage: 90 líneas
- src/modules/portfolio/loan-calculation.test.ts — <anónima>: 90 líneas (test)
- src/app/api/super-admin/businesses/[businessId]/admin-password/route.test.ts — <anónima>: 88 líneas (test)
- src/tests/integration/cash-commands-guards.test.ts — <anónima>: 88 líneas (test)
- src/tests/integration/portfolio-hardening.test.ts — <anónima>: 88 líneas (test)
- src/tests/integration/cash-ledger-schema.test.ts — <anónima>: 87 líneas (test)
- src/app/(auth)/login/login-form.tsx — LoginForm: 86 líneas
- src/modules/identity/reset-admin-password.ts — runReset: 86 líneas
- src/modules/cash/run-cash-command.ts — runCashCommand: 85 líneas
- src/modules/collections/assignments.ts — assignClient: 85 líneas
- src/tests/integration/business-lifecycle.test.ts — <anónima>: 85 líneas (test)
- src/tests/integration/dashboard.test.ts — <anónima>: 85 líneas (test)
- src/app/negocio/prestamos/_components/late-fees.tsx — CreateLateFee: 84 líneas
- src/modules/support/tickets.ts — attendTicket: 84 líneas
- src/tests/integration/late-fees.test.ts — <anónima>: 84 líneas (test)
- src/tests/integration/sessions.test.ts — <anónima>: 84 líneas (test)
- src/app/negocio/_components/dashboard-view.tsx — Widget: 83 líneas
- src/tests/e2e/journeys.spec.ts — <anónima>: 82 líneas (test)
- src/app/negocio/_components/confirm-action.tsx — ConfirmAction: 81 líneas
- src/app/negocio/jornadas/page.tsx — <anónima>: 81 líneas
- src/tests/integration/business-lifecycle.test.ts — <anónima>: 81 líneas (test)

El reporte no determina duplicación, código muerto ni comentarios innecesarios; no propone dividir una función solo por su tamaño.

## Alcance y limitaciones

Este baseline es una señal para revisión, no un umbral de calidad: el tamaño por sí solo no prueba mala estructura. No detecta duplicación, código muerto, abstracciones sin uso, utilidades duplicadas, comentarios obvios, any/@ts-ignore ni tests tautológicos. Para esos casos se requiere búsqueda dirigida y revisión; herramientas candidatas para evaluar por separado: madge o dependency-cruiser (ciclos), jscpd (duplicación) y knip (código sin uso). No se instalaron dependencias ni se activaron gates nuevos.
