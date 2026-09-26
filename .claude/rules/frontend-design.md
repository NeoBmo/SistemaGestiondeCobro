# Reglas de diseño frontend

> Aplica a todo componente dentro de `src/app/` y `src/shared/ui/`. Basado en `docs/planning/03-ARQUITECTURA.md` §5 (Interfaz). Stack: Next.js 16 (App Router) + React 19 + TypeScript estricto + Tailwind CSS 4.

## 1. Componentes responsivos

- Mobile-first siempre: se diseña primero para el perfil **Cobrador** (uso en calle, pantalla pequeña, una mano libre), luego se escala a Admin/Super Admin (escritorio).
- Breakpoints Tailwind por defecto (`sm 640 / md 768 / lg 1024 / xl 1280`); no se crean breakpoints custom sin justificación documentada en el PR.
- Ningún componente fija ancho/alto en `px` salvo iconografía puntual; usar unidades relativas, `flex`/`grid`.
- Objetivo táctil mínimo de 44×44px en botones/acciones del perfil Cobrador (llamar, WhatsApp, registrar pago).

## 2. Accesibilidad — WCAG 2.1 nivel AA mínimo

- Contraste de texto ≥ 4.5:1 (texto normal) / 3:1 (texto grande).
- Todo elemento interactivo es alcanzable por teclado (`Tab`, `Enter`, `Esc`) y tiene estado de foco visible — nunca `outline: none` sin sustituto equivalente.
- Formularios: `label` asociado a cada input, errores anunciados (`aria-live` o `aria-describedby`), el color nunca es el único indicador de error.
- Imágenes decorativas con `alt=""`; imágenes con significado con `alt` descriptivo.
- Componentes complejos (modal, dropdown, tabs) siguen el patrón ARIA correspondiente antes de escribirse a mano — no se improvisa semántica.

## 3. Micro-animaciones

- Uso mínimo y funcional, nunca decorativo: confirmar una acción (pago registrado, gasto guardado), transición de estado (carga → éxito), o feedback de error.
- Duración 150–250ms; `ease-out` en entradas, `ease-in` en salidas.
- Respetar `prefers-reduced-motion`: toda animación no esencial se desactiva si el usuario lo pide.
- Nunca animar una operación financiera mientras está en curso — un comando de pago muestra estado de carga simple, no una animación decorativa que sugiera progreso falso.

## 4. Jerarquía tipográfica

| Nivel | Uso | Clase Tailwind |
|---|---|---|
| Display | Landing / hero | `text-4xl md:text-5xl font-bold` |
| H1 | Título de página | `text-2xl md:text-3xl font-semibold` |
| H2 | Sección | `text-xl font-semibold` |
| H3 | Subsección / tarjeta | `text-lg font-medium` |
| Body | Texto general | `text-base` |
| Caption | Metadatos, fechas, ayuda | `text-sm text-muted` |
| Dato financiero | Montos, saldos, cuotas | `font-mono tabular-nums` — nunca fuente decorativa para dinero |

## 5. Gestión de estado visual

Todo componente que consulta o muta datos define explícitamente sus **4 estados obligatorios**: `carga`, `vacío`, `error`, `éxito`. Ningún componente financiero se entrega sin los cuatro (ya exigido en `03-ARQUITECTURA.md` §5).

- **Carga**: skeleton o spinner — nunca contenido en blanco sin indicación.
- **Vacío**: mensaje + acción sugerida (ej. "Sin clientes asignados aún" con botón a asignar).
- **Error**: mensaje entendible por el rol que lo ve (Cobrador ≠ Admin), nunca un stack trace ni un código HTTP crudo.
- **Éxito**: confirmación breve; en comandos financieros, mostrar el resultado verificable (saldo actualizado, cuota afectada) — no solo un toast genérico de "listo".

## 6. Color y significado

- El color nunca es el único portador de significado en datos financieros (mora, saldo negativo, diferencia de caja) — siempre acompañado de texto o ícono.
- Paleta semántica consistente en todo el proyecto: éxito/verde, alerta/ámbar, error/rojo, neutro/gris — definida una vez como tokens de Tailwind, reutilizada siempre, nunca redefinida por componente.
