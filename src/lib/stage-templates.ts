// Canonical stage set used to bootstrap every project.
export const STAGE_TEMPLATE = [
  { key: "planning", name: "Planning", description: "Understand scope, define features, write user stories." },
  { key: "research", name: "Research", description: "Competitor analysis, tech spikes, feasibility." },
  { key: "design", name: "UI/UX Design", description: "Wireframes, mockups, design system." },
  { key: "database", name: "Database Design", description: "ERD, schema, migrations, RLS." },
  { key: "backend", name: "Backend", description: "APIs, business logic, server functions." },
  { key: "frontend", name: "Frontend", description: "Components, screens, state, routing." },
  { key: "api", name: "API Integration", description: "Third-party APIs and webhooks." },
  { key: "auth", name: "Authentication", description: "Sign-in, sessions, roles, permissions." },
  { key: "admin", name: "Admin Panel", description: "Admin dashboards, moderation tools." },
  { key: "testing", name: "Testing", description: "Unit, integration, E2E, QA." },
  { key: "deployment", name: "Deployment", description: "CI/CD, environment setup, hosting." },
  { key: "launch", name: "Launch", description: "Marketing site, docs, go-live checklist." },
  { key: "maintenance", name: "Maintenance", description: "Monitoring, bug triage, iteration." },
] as const;

export type StageKey = (typeof STAGE_TEMPLATE)[number]["key"];

export const PROMPT_TARGETS = [
  "chatgpt",
  "claude",
  "gemini",
  "cursor",
  "replit",
  "lovable",
  "figma",
] as const;
export type PromptTarget = (typeof PROMPT_TARGETS)[number];
