import type { Metadata } from "next";
import { PRIVATE_ROBOTS } from "@/lib/site";
export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to save your ProspectAI research, evidence and drafts.",
  robots: PRIVATE_ROBOTS,
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
