import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "FightScore — судейство и табло",
    short_name: "FightScore",
    description: "Турниры, судейская панель и ТВ-табло для соревнований по единоборствам",
    lang: "ru",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#07101f",
    theme_color: "#07101f",
    categories: ["sports", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Мои поединки", short_name: "Судья", url: "/judge", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Открыть табло", short_name: "Табло", url: "/display", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Панель организатора", short_name: "Панель", url: "/dashboard", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
