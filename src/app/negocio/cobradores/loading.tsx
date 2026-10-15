import { Spinner } from "@/shared/ui/spinner";

export default function Loading() {
  return (
    <div className="py-8">
      <Spinner label="Cargando los cobradores" />
    </div>
  );
}
