import type { Metadata } from "next";
import { DashboardPage } from "@/src/components/pages/DashboardPage/DashboardPage";

export const metadata: Metadata = { title: "Обзор" };

export default function Page() {
  return <DashboardPage />;
}
