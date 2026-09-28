import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Cuadre", template: "%s · Cuadre" },
  description: "Gestión de cobros con trazabilidad financiera completa.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <a
          href="#contenido"
          className="bg-primary text-primary-foreground sr-only rounded px-4 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
        >
          Saltar al contenido
        </a>
        {children}
      </body>
    </html>
  );
}
