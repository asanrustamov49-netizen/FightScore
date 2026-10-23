import type { Metadata } from "next";
import { AdminLoginPage } from "@/src/components/pages/AdminLoginPage/AdminLoginPage";

export const metadata: Metadata = { title: "Вход для администратора", robots: { index: false, follow: false } };

export default function Page() {
  return <AdminLoginPage />;
}
