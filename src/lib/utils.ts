import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
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
    verification_status: string;
  }[],
) {
  return [
    ["Name", "Category", "City", "Country", "Verification"],
    ...rows.map((b) => [
      b.name,
      b.category,
      b.city,
      b.country,
      b.verification_status,
    ]),
  ]
    .map((r) => r.map(csvCell).join(","))
    .join("\r\n");
}
