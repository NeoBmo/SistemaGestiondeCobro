export default function CobradorLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main id="contenido" className="mx-auto w-full max-w-lg px-4 py-4">
      {children}
    </main>
  );
}
