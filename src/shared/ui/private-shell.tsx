import type { ReactNode } from "react";
import type { Role, SessionContext } from "@/modules/identity/session";
import { BrandMark } from "./brand-mark";
import { LogoutButton } from "./logout-button";

const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN_NEGOCIO: "Administrador",
  COBRADOR: "Cobrador",
};

type Props = {
  /** Nombre del área (p. ej. «Plataforma»). */
  area: string;
  session: SessionContext;
  /** Clase de ancho máximo del contenido; el cobrador usa una sola columna (mobile-first). */
  widthClass?: string;
  children: ReactNode;
};

/** Cabecera común de las áreas privadas: quién eres, en qué área y cómo salir. */
export function PrivateShell({ area, session, widthClass = "max-w-7xl", children }: Props) {
  return (
    <>
      <header className="border-border border-b">
        <div
          className={`mx-auto flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 ${widthClass}`}
        >
          <p className="inline-flex min-w-0 flex-wrap items-center gap-2 text-lg font-semibold break-words">
            <BrandMark />
            Cuadre <span className="text-muted font-normal">· {area}</span>
          </p>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <p className="min-w-0 text-sm break-words">
              <span className="font-medium">{session.displayName}</span>
              <span className="text-muted"> · {ROLE_LABEL[session.role]}</span>
            </p>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main id="contenido" className={`mx-auto w-full px-4 py-6 ${widthClass}`}>
        {children}
      </main>
    </>
  );
}
