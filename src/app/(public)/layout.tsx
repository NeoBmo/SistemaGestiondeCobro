export default function PublicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main id="contenido" className="mx-auto w-full max-w-5xl px-4 py-8">
      {children}
    </main>
  );
}
