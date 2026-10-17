import type { Metadata } from "next";
import { DisplaysPage } from "@/src/components/pages/DisplaysPage/DisplaysPage";

export const metadata: Metadata = { title: "Табло" };

export default function Page() {
  return <DisplaysPage />;
}
