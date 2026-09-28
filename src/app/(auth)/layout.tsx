export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main id="contenido" className="mx-auto w-full max-w-md px-4 py-8">
      {children}
    </main>
  );
}
