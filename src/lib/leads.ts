import type { Business } from "./types";

export type LeadSort = "newest" | "name" | "confidence";
export type LeadColumns = {
  contact: boolean;
  confidence: boolean;
  discovered: boolean;
};
export const leadsPageSize = 10;

const normalize = (value: string) => value.trim().toLocaleLowerCase();
export function filterAndSortLeads(
  businesses: Business[],
  {
    query,
    websiteStatus,
    category,
    sort,
  }: { query: string; websiteStatus: string; category: string; sort: LeadSort },
) {
  const needle = normalize(query);
  return businesses
    .filter((lead) => {
      const matchesSearch =
        !needle ||
        [lead.name, lead.city, lead.country].some((value) =>
          normalize(value).includes(needle),
        );
      const matchesWebsite =
        websiteStatus === "all" || lead.website_status === websiteStatus;
      return (
        matchesSearch &&
        matchesWebsite &&
        (category === "all" || lead.category === category)
      );
    })
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : sort === "confidence"
          ? b.activity_confidence - a.activity_confidence ||
            a.name.localeCompare(b.name)
          : new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
}
export function leadPage(rows: Business[], page: number) {
  const pages = Math.max(1, Math.ceil(rows.length / leadsPageSize));
  const safePage = Math.min(Math.max(1, page), pages);
  return {
    pages,
    page: safePage,
    rows: rows.slice((safePage - 1) * leadsPageSize, safePage * leadsPageSize),
  };
}
export function duplicateWarning(leads: Business[]) {
  return leads.filter(
    (lead) =>
      lead.duplicate_group_id &&
      lead.duplicate_review_status === "manual_review",
  );
}
