import { createSupabaseServerClient } from "@/shared/database/supabase-server";
import { assertSameOrigin, commandResponse, errorResponse } from "@/shared/http/command-response";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    // Solo este dispositivo: las sesiones en otros dispositivos siguen abiertas.
    await (await createSupabaseServerClient()).auth.signOut({ scope: "local" });
    return commandResponse({});
  } catch (error) {
    return errorResponse(error);
  }
}
