# Nota para la revisión jurídica — Cuadre (V1)

> **Borrador preparado sin asesoría legal** (2026-10-24) para que un abogado colombiano lo revise antes de operar con datos reales. No es una opinión jurídica. Los otros dos documentos de esta carpeta son borradores que dependen de las respuestas a estas preguntas.

## Qué es el producto

Cuadre es un software como servicio (SaaS) multi-negocio. Cada **negocio cliente** (persona natural o jurídica que presta dinero) lo usa para registrar sus deudores, contratos de préstamo, cuotas, pagos, mora, cobradores, rutas de cobro y caja. El proveedor del software no presta dinero, no cobra deudas, no reporta a centrales de riesgo y no interviene en la relación entre el negocio y sus deudores.

Datos que el sistema almacena (fuente: `docs/planning/02-DOMINIO.md`):

- **Deudores (clientes del negocio):** nombre, sobrenombre opcional, número de identificación, dirección, teléfono, WhatsApp, notas; sus préstamos, cuotas, pagos, cargos de mora e intentos de cobro (con motivo: ausente, lugar cerrado, sin dinero, dirección incorrecta, otro).
- **Usuarios de la plataforma:** nombre visible, nombre de usuario, rol, negocio; inicios de sesión fallidos con IP (registro de seguridad).
- **Negocios:** nombre, responsable (nombre e identificación), teléfono, plan y suscripción.
- **Auditoría inmutable** de cada acción financiera y administrativa (quién, qué, cuándo). Al editar un deudor solo registra qué campos cambiaron, no sus valores.
- Sin geolocalización, sin datos biométricos y sin datos de menores. Las notas son texto libre.

Infraestructura: base de datos en Supabase y aplicación en Vercel (ambos prestadores, en principio, con servidores fuera de Colombia — **región por confirmar**).

## Preguntas jurídicas abiertas

1. **Roles bajo la Ley 1581 de 2012.** Nuestra hipótesis: cada negocio es **Responsable** del tratamiento de los datos de sus deudores y el proveedor es **Encargado** (trata los datos por cuenta del negocio); el proveedor es Responsable solo de los datos de los usuarios de la plataforma y de los negocios. ¿Es correcto? ¿Basta con que los Términos y Condiciones contengan las cláusulas del contrato de transmisión (Decreto 1377 de 2013, compilado en el Decreto 1074 de 2015), o hace falta un contrato separado?
2. **Transmisión internacional.** Supabase y Vercel almacenan o procesan datos fuera de Colombia. ¿Qué exige el régimen de transmisión (no transferencia) a sub-encargados en el exterior, y cómo debe informarse en la política?
3. **Ley 2300 de 2023 («Dejen de fregar»).** Aplica a personas naturales y jurídicas que adelanten gestiones de cobranza (art. 1, parágrafo). Su artículo 6 prohíbe la cobranza mediante visitas al domicilio o lugar de trabajo, salvo microcrédito, crédito de fomento o agropecuario **con autorización expresa** (parágrafo 1) o imposibilidad de contacto certificada (parágrafo 2). El modelo de negocio de los clientes se basa en cobradores que recogen la cuota acordada en persona.
   - ¿El recaudo presencial de una cuota **pactada en el contrato de préstamo** es «gestión de cobranza» a efectos del art. 6, o es recaudo de un pago acordado?
   - ¿Qué forma debe tener la autorización expresa para que sea válida (art. 3, parágrafo: instrumento distinto y posterior al contrato)?
   - Decisión del dueño para V1: la app **no** registra las autorizaciones ni restringe horarios; el cumplimiento queda como obligación del negocio en los Términos. ¿Es suficiente para limitar la responsabilidad del proveedor?
4. **Tasa de usura.** Cobrar intereses por encima de la tasa de usura certificada por la Superintendencia Financiera es delito (art. 305 del Código Penal). Decisión del dueño para V1: la app **advierte** cuando la tasa efectiva anual equivalente de un préstamo supera la usura vigente registrada, y la confirmación queda auditada; **no bloquea**. ¿Es suficiente para limitar la responsabilidad del proveedor, o debería bloquear?
   - ¿Qué tasa debe usarse como referencia: consumo y ordinario, o microcrédito?
   - ¿El cálculo de equivalencia a tasa efectiva anual debe considerar la mora?
5. **Ley 1266 de 2008 (habeas data financiero).** La app **no** reporta a operadores de información (centrales de riesgo). ¿Debe declararse expresamente que el proveedor no es fuente ni operador, y qué obligaciones tendría el negocio si decide reportar por su cuenta?
6. **Conservación vs. supresión.** La auditoría y los movimientos financieros son inmutables. Un deudor sin contratos puede eliminarse; con historial, no. ¿Es correcto fundamentar la conservación en el deber de conservar libros y papeles del comerciante (Código de Comercio, art. 60, 10 años) y en la finalidad probatoria? ¿Cómo se atiende una solicitud de supresión de un deudor con historial?
7. **Registro Nacional de Bases de Datos (RNBD).** ¿El proveedor o los negocios clientes están obligados a inscribir sus bases de datos ante la SIC según su naturaleza y activos?
8. **Legalidad de la actividad de los clientes.** Los negocios prestan dinero con recursos propios a personas. ¿Qué declaraciones, prohibiciones y causales de suspensión deben incluir los Términos para que el proveedor no facilite captación ilegal, lavado de activos o cobro abusivo?
9. **Identidad del proveedor.** Falta definir quién presta el servicio (persona natural o sociedad, NIT, domicilio y correo de contacto) para completar ambos documentos.

## Fuentes consultadas

- Ley 1581 de 2012 y Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015).
- Ley 2300 de 2023, texto en la [compilación de la Alcaldía de Bogotá](https://www.alcaldiabogota.gov.co/sisjur/normas/Norma1.jsp?i=143903): arts. 1, 2, 3 y 6.
- Ley 1266 de 2008 modificada por la Ley 2157 de 2021.
- Código Penal, art. 305 (usura). Tasa de usura de consumo para octubre de 2026 reportada en prensa: 28,59 % E.A. (confirmar en la Superintendencia Financiera).
