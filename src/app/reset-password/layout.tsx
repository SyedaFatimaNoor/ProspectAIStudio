import type { Metadata } from "next";
import { PRIVATE_ROBOTS } from "@/lib/site";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Request a secure password-recovery link for your ProspectAI account.",
  robots: PRIVATE_ROBOTS,
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
