import { Suspense } from "react";
import { AppShell } from "@/src/components/layout/AppShell/AppShell";
import { Loading } from "@/src/components/ui/Notice/Notice";
import { ToastProvider } from "@/src/components/ui/Toast/Toast";
import { SessionProvider } from "@/src/lib/session";

// URL hooks (usePathname/useParams) need a Suspense boundary with Cache Components.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Loading />}>
      <SessionProvider>
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </SessionProvider>
    </Suspense>
  );
}
