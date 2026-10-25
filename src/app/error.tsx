"use client";
import { useEffect } from "react";
import { RefreshCw, ArrowLeft, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Workspace rendering failed", error.digest || error.name);
  }, [error]);
  return (
    <div className="error-page">
      <span className="error-icon">
        <TriangleAlert size={30} />
      </span>
      <h1>Let’s give that another try.</h1>
      <p>
        This view couldn’t load. Your saved workspace data has not been changed.
      </p>
      <div>
        <Button onClick={reset}>
          <RefreshCw size={16} />
          Try again
        </Button>
        <Button variant="outline" asChild>
          <Link href="/overview">
            <ArrowLeft size={16} />
            Workspace overview
          </Link>
        </Button>
      </div>
    </div>
  );
}
