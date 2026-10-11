import Link from "next/link";

export default function PublicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <header className="border-border border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="text-xl font-semibold">
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
