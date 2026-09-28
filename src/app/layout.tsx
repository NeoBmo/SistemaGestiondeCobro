import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cuadre",
  description: "Gestión de cobros con trazabilidad financiera completa.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
