import type { Metadata } from "next";
import { PRIVATE_ROBOTS } from "@/lib/site";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { Shell } from "@/components/shell";
export const metadata: Metadata = { robots: PRIVATE_ROBOTS };
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <Shell>{children}</Shell>
    </WorkspaceProvider>
  );
}
