import type { Metadata } from "next";
import { SITE_ORIGIN } from "@/lib/site";
import "@fontsource-variable/inter";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  applicationName: "ProspectAI",
  icons: {
    icon: [
      {
        url: "/favicon.ico",
        sizes: "16x16 32x32 48x48 64x64",
        type: "image/x-icon",
      },
      { url: "/icon.svg", type: "image/svg+xml", sizes: "any" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  title: {
    default: "ProspectAI — Discover potential. Build connections.",
    template: "%s · ProspectAI",
  },
  description:
    "Discover businesses, verify public evidence, and prepare thoughtful website proposals. Real sources. Transparent verification. Responsible outreach.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
