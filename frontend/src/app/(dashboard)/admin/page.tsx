import type { Metadata } from "next";
import { AdminPage } from "@/src/components/pages/AdminPage/AdminPage";

export const metadata: Metadata = { title: "Администрирование" };

export default function Page() {
  return <AdminPage />;
}
