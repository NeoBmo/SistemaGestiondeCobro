import type { Metadata } from "next";
import { getPublicSiteUrl } from "@/shared/validation/env";
import "./globals.css";
import { brandMono, brandSans } from "./fonts";

export const metadata: Metadata = {
  metadataBase: new URL(getPublicSiteUrl()),
  title: { default: "Cuadre", template: "%s · Cuadre" },
  description: "Gestión de cobros con trazabilidad financiera completa.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${brandSans.variable} ${brandMono.variable}`}>
      <body className="font-sans">
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
