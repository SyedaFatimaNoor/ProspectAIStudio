import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}
export function download(name: string, content: string, type = "text/plain") {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 500);
}
export function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function exportBusinesses(
  rows: {
    name: string;
    category: string;
    city: string;
    country: string;
    source_url?: string | null;
    source_observed_at?: string | null;
    verification_status: string;
    activity_confidence?: number;
    website_confidence?: number;
  }[],
) {
  // Deliberately whitelist business-facing fields. Provider tokens, user IDs,
  // internal facts, and source credentials cannot enter this export.
  return [
    [
      "Name",
      "Category",
      "City",
      "Country",
      "Source URL",
      "Source observed at",
      "Verification status",
      "Activity confidence",
      "Website confidence",
    ],
    ...rows.map((b) => [
      b.name,
      b.category,
      b.city,
      b.country,
      b.source_url || "",
      b.source_observed_at || "",
      b.verification_status,
      b.activity_confidence ?? "",
      b.website_confidence ?? "",
    ]),
  ]
    .map((r) => r.map(csvCell).join(","))
    .join("\r\n");
}
