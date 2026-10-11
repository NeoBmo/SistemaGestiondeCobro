"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postCommand } from "./command-client";
import { Button } from "./button";

/** Cierra solo la sesión de este dispositivo (`/api/auth/logout`, scope local) y vuelve al login. */
export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    await postCommand("/api/auth/logout", {});
    router.replace("/login");
    router.refresh();
  }

  return (
    <Button variant="secondary" onClick={logout} loading={loading} loadingText="Saliendo…">
      Cerrar sesión
    </Button>
  );
}
