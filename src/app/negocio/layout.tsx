export default function NegocioLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main id="contenido" className="mx-auto w-full max-w-7xl px-4 py-6">
      {children}
    </main>
  );
}
