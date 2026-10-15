import Link from "next/link";

export default function ClientNotFound() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Cliente no encontrado</h1>
      <p className="text-muted mt-2 text-sm">
        Ese cliente no está en tu ruta. Puede que el administrador lo haya reasignado.
      </p>
      <Link href="/cobrador" className="text-primary mt-4 inline-block underline">
        Volver a mi ruta
      </Link>
    </>
  );
}
