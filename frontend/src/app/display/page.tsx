import type { Metadata } from "next";
import { DisplayEntryPage } from "@/src/components/pages/DisplayEntryPage/DisplayEntryPage";

export const metadata: Metadata = { title: "Открыть табло" };

export default function Page() {
  return <DisplayEntryPage />;
}
