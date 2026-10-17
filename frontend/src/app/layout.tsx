import type { Metadata, Viewport } from "next";
import { PwaRegistration } from "@/src/lib/pwa";
import "./globals.scss";

export const metadata: Metadata = {
  title: { default: "FightScore", template: "%s · FightScore" },
  description: "Управление соревнованиями по единоборствам: турниры, судейство, табло",
  applicationName: "FightScore",
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "FightScore", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#07101f",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru">
      <body>
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
