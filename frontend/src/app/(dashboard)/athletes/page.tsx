import type { Metadata } from "next";
import { AthletesPage } from "@/src/components/pages/AthletesPage/AthletesPage";

export const metadata: Metadata = { title: "Спортсмены" };

export default function Page() {
  return <AthletesPage />;
}
