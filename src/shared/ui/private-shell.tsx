import type { ReactNode } from "react";
import type { Role, SessionContext } from "@/modules/identity/session";
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
          <p className="text-lg font-semibold">
            Cuadre <span className="text-muted font-normal">· {area}</span>
          </p>
          <div className="flex items-center gap-3">
            <p className="text-sm">
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
