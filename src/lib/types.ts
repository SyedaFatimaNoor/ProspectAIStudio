export type Business = {
  id: string;
  name: string;
  category: string;
  city: string;
  country: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  source_url: string | null;
  provider: string;
  source_id: string;
  activity_status: string;
  website_status: string;
  activity_confidence: number;
  website_confidence: number;
  verification_status: string;
  outreach_status: string;
  notes: string;
  created_at: string;
  facts: Record<string, unknown>;
};
export type Job = {
  id: string;
  country: string;
  city: string;
  category: string;
  max_results: number;
  status: string;
  processed: number;
  total: number;
  error: string | null;
  logs: string[];
  created_at: string;
  provider?: string;
  attempts?: number;
  next_retry_at?: string | null;
  updated_at?: string;
};
export type Proposal = {
  id: string;
  business_id: string;
  title: string;
  content: string;
  version: number;
  origin: string;
  created_at: string;
};
export type Message = {
  id: string;
  business_id: string;
  channel: "email" | "whatsapp";
  recipient: string;
  subject: string;
  body: string;
  status: string;
  lawful_basis: string;
  created_at: string;
};
export type Evidence = {
  type: string;
  detail: string;
  url?: string;
  timestamp: string;
};
export type Run = {
  id: string;
  business_id: string;
  status: string;
  explanation: string;
  evidence: Evidence[];
  created_at: string;
  error: string | null;
};
export type ProviderHealthRecord = {
  provider: "database" | "discovery" | "worker" | "ai" | "email" | "whatsapp";
  status:
    | "reachable"
    | "paused"
    | "blocked"
    | "not_configured"
    | "not_applicable"
    | "unreachable"
    | "rate_limited";
  checked_at: string;
  last_success_at: string | null;
  latency_ms: number | null;
  last_error: string | null;
  recommended_action: string;
};
export type Workspace = {
  user: {
    id: string;
    email?: string;
    display_name?: string;
    updated_at?: string;
  } | null;
  businesses: Business[];
  jobs: Job[];
  proposals: Proposal[];
  messages: Message[];
  runs: Run[];
  suppressions: { id: string; contact: string; reason: string }[];
  events: {
    event_type: string;
    message_id?: string;
    detail?: string;
    created_at?: string;
  }[];
  provider_health: ProviderHealthRecord[];
  settings: {
    search_limit: number;
    verification_threshold: number;
    retention_days: number;
  } | null;
  config: {
    database: boolean;
    discovery: boolean;
    discovery_error?: string;
    ai: boolean;
    self_hosted_worker?: boolean;
    snapshot?: {
      businesses: number;
      places: number;
      oldest_snapshot: string | null;
      newest_snapshot: string | null;
      import_status?: "empty" | "loading" | "ready" | "failed" | string;
      source_name?: string | null;
      source_url?: string | null;
      attribution?: string | null;
      dataset_timestamp?: string | null;
      last_successful_import_at?: string | null;
      places_imported?: number;
      businesses_imported?: number;
      last_import_error?: string | null;
    };
    worker?: {
      enabled: boolean;
      mode: "listing-only";
      daily_limit: number;
      daily_attempts: number;
      daily_remaining?: number;
      interval_minutes: number;
      last_started_at: string | null;
      last_finished_at: string | null;
      last_successful_at?: string | null;
      last_error?: string | null;
    };
  };
  windowed?: boolean;
  error?: string;
};
export const emptyWorkspace: Workspace = {
  user: null,
  businesses: [],
  jobs: [],
  proposals: [],
  messages: [],
  runs: [],
  suppressions: [],
  events: [],
  provider_health: [],
  settings: null,
  config: { database: false, discovery: false, ai: false },
};
