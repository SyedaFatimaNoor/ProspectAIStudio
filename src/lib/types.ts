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
export type Workspace = {
  user: { id: string; email?: string; display_name?: string } | null;
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
  settings: {
    search_limit: number;
    verification_threshold: number;
    retention_days: number;
  } | null;
  config: {
    database: boolean;
    discovery: boolean;
    ai: boolean;
    self_hosted_worker?: boolean;
    worker?: {
      enabled: boolean;
      mode: "listing-only";
      daily_limit: number;
      daily_attempts: number;
      interval_minutes: number;
      last_started_at: string | null;
      last_finished_at: string | null;
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
  settings: null,
  config: { database: false, discovery: false, ai: false },
};
