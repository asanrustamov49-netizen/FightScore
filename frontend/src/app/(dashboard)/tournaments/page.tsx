import type { Metadata } from "next";
import { TournamentsPage } from "@/src/components/pages/TournamentsPage/TournamentsPage";

export const metadata: Metadata = { title: "Турниры" };

export default function Page() {
  return <TournamentsPage />;
}
