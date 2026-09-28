import type { Metadata } from "next";

export const metadata: Metadata = { title: "Super Admin" };

export default function SuperAdminPage() {
  return <h1 className="text-2xl font-semibold md:text-3xl">Super Admin</h1>;
}
