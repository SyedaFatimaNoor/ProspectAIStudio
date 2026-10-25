import type { Metadata } from "next";
export const metadata: Metadata = { title: "Website concept studio" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
