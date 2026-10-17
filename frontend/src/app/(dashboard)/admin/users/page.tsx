import type { Metadata } from "next";
import { UsersPage } from "@/src/components/pages/UsersPage/UsersPage";

export const metadata: Metadata = { title: "Пользователи" };

export default function Page() {
  return <UsersPage />;
}
