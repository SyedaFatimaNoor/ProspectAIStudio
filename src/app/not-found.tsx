import Link from "next/link";
import { Compass, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
export default function NotFound() {
  return (
    <main className="error-page">
      <span className="error-icon">
        <Compass size={32} />
      </span>
      <div className="eyebrow">A LITTLE OFF THE MAP · 404</div>
      <h1>There’s a better direction from here.</h1>
      <p>This page doesn’t exist. Your next opportunity is still out there.</p>
      <Button asChild>
        <Link href="/overview">
          Back to workspace
          <ArrowRight size={16} />
        </Link>
      </Button>
    </main>
  );
}
