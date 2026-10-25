import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
export const metadata: Metadata = {
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
