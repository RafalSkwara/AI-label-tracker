import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Side Hustle Assistant",
    short_name: "Side Hustle",
    description: "Asystent projektów side hustle: alerty, YouTube, zadania, KPI i koszty",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f5f3",
    theme_color: "#1d6b58",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
