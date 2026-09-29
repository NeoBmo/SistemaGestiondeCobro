import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool } from "pg";

export function normalizeUsername(username: string): string;
export function isValidUsername(username: string): boolean;
export function passwordIssues(password: string): string[];
export function buildSyntheticEmail(username: string, domain: string): string;

export function createSuperAdmin(
  deps: {
    db: Pick<Pool, "connect" | "query">;
    admin: { auth: { admin: Pick<SupabaseClient["auth"]["admin"], "createUser" | "deleteUser"> } };
    syntheticEmailDomain: string;
  },
  input: { username: string; displayName: string; password: string },
): Promise<{ userId: string; username: string }>;
