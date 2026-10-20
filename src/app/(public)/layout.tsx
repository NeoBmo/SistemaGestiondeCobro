import Link from "next/link";
import type { Metadata } from "next";
import { BrandMark } from "@/shared/ui/brand-mark";

export const metadata: Metadata = {
  title: { absolute: "Cuadre" },
  description: "Gestión de cobros con trazabilidad financiera completa.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Cuadre",
    description: "Gestión de cobros con trazabilidad financiera completa.",
    siteName: "Cuadre",
    type: "website",
    url: "/",
  },
};

export default function PublicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <header className="border-border border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="inline-flex items-center gap-2 text-xl font-semibold">
            <BrandMark />
            Cuadre
          </Link>
          <Link
            href="/login"
            className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-lg px-4 font-medium"
          >
            Iniciar sesión
          </Link>
        </div>
      </header>
      <main id="contenido" className="mx-auto w-full max-w-5xl px-4 py-8">
        {children}
      </main>
      <footer className="border-border text-muted mt-8 border-t">
        <p className="mx-auto w-full max-w-5xl px-4 py-4 text-sm">
          Cuadre · Gestión de cobros con trazabilidad financiera completa.
        </p>
      </footer>
    </>
  );
}
