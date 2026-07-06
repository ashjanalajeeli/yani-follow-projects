// Curated catalog of FREE tools recommended per stage/category.
// Every tool here has a genuinely usable free tier.

export type ToolCategory =
  | "design"
  | "backend"
  | "database"
  | "frontend"
  | "hosting"
  | "auth"
  | "storage"
  | "testing"
  | "devtools"
  | "ai"
  | "docs"
  | "collab"
  | "monitoring";

export interface ToolEntry {
  name: string;
  category: ToolCategory;
  url: string;
  why: string;
}

export const TOOLS: ToolEntry[] = [
  // Design
  { name: "Figma (Free)", category: "design", url: "https://figma.com", why: "Design UI/wireframes free for up to 3 files." },
  { name: "Penpot", category: "design", url: "https://penpot.app", why: "Fully open-source Figma alternative, unlimited files." },
  { name: "Excalidraw", category: "design", url: "https://excalidraw.com", why: "Free whiteboard for wireframes & flows." },
  { name: "tldraw", category: "design", url: "https://tldraw.com", why: "Free collaborative whiteboard." },

  // Backend / BaaS
  { name: "Supabase", category: "backend", url: "https://supabase.com", why: "Postgres + Auth + Storage + Edge Fns on a generous free tier." },
  { name: "Firebase (Spark)", category: "backend", url: "https://firebase.google.com", why: "Google-backed BaaS with a free tier for auth/DB/hosting." },
  { name: "Appwrite Cloud", category: "backend", url: "https://appwrite.io", why: "Open-source BaaS with a free tier." },
  { name: "PocketBase", category: "backend", url: "https://pocketbase.io", why: "Single-file open-source backend you self-host free." },

  // Database
  { name: "Supabase Postgres", category: "database", url: "https://supabase.com", why: "Managed Postgres free tier." },
  { name: "Neon", category: "database", url: "https://neon.tech", why: "Serverless Postgres with a free tier and branching." },
  { name: "SQLite", category: "database", url: "https://sqlite.org", why: "Zero-cost embedded database." },
  { name: "Turso", category: "database", url: "https://turso.tech", why: "Edge SQLite with a free tier." },

  // Frontend
  { name: "React", category: "frontend", url: "https://react.dev", why: "Component-based UI library, industry standard." },
  { name: "Next.js", category: "frontend", url: "https://nextjs.org", why: "Full-stack React framework, free & open source." },
  { name: "Vite", category: "frontend", url: "https://vite.dev", why: "Fast dev server and build tool." },
  { name: "TanStack Start", category: "frontend", url: "https://tanstack.com/start", why: "Modern SSR React framework." },

  // Hosting
  { name: "Vercel (Hobby)", category: "hosting", url: "https://vercel.com", why: "Free hosting for Next.js and static sites." },
  { name: "Netlify", category: "hosting", url: "https://netlify.com", why: "Free hosting with build minutes for JAMstack." },
  { name: "Cloudflare Pages", category: "hosting", url: "https://pages.cloudflare.com", why: "Unlimited-bandwidth free static hosting." },
  { name: "Render", category: "hosting", url: "https://render.com", why: "Free web-service tier for small apps." },
  { name: "Railway", category: "hosting", url: "https://railway.app", why: "Free trial credits monthly." },
  { name: "Fly.io", category: "hosting", url: "https://fly.io", why: "Free tier for small VMs." },

  // Auth
  { name: "Supabase Auth", category: "auth", url: "https://supabase.com/auth", why: "Email/password + OAuth free." },
  { name: "Firebase Auth", category: "auth", url: "https://firebase.google.com/products/auth", why: "Free tier for 50k MAUs." },
  { name: "Clerk (Free)", category: "auth", url: "https://clerk.com", why: "Free up to 10k MAUs." },

  // Storage
  { name: "Supabase Storage", category: "storage", url: "https://supabase.com/storage", why: "1 GB free storage." },
  { name: "Cloudinary (Free)", category: "storage", url: "https://cloudinary.com", why: "25 GB storage/bandwidth free for images/video." },
  { name: "Backblaze B2", category: "storage", url: "https://backblaze.com/b2", why: "10 GB free object storage." },

  // Dev tools
  { name: "VS Code", category: "devtools", url: "https://code.visualstudio.com", why: "Free open-source editor." },
  { name: "Cursor (Free)", category: "devtools", url: "https://cursor.sh", why: "AI editor with free tier." },
  { name: "Replit", category: "devtools", url: "https://replit.com", why: "Free browser IDE and hosting." },
  { name: "GitHub", category: "devtools", url: "https://github.com", why: "Free unlimited public/private repos + Actions minutes." },
  { name: "Zed", category: "devtools", url: "https://zed.dev", why: "Fast free code editor." },

  // Testing
  { name: "Postman (Free)", category: "testing", url: "https://postman.com", why: "API testing on free plan." },
  { name: "Bruno", category: "testing", url: "https://usebruno.com", why: "Free open-source API client." },
  { name: "Playwright", category: "testing", url: "https://playwright.dev", why: "Free E2E testing framework." },
  { name: "Vitest", category: "testing", url: "https://vitest.dev", why: "Free unit test runner for Vite." },
  { name: "Jest", category: "testing", url: "https://jestjs.io", why: "Free unit test framework." },

  // AI
  { name: "ChatGPT (Free)", category: "ai", url: "https://chat.openai.com", why: "Free tier of GPT for research/coding help." },
  { name: "Claude (Free)", category: "ai", url: "https://claude.ai", why: "Free tier of Anthropic Claude." },
  { name: "Google AI Studio", category: "ai", url: "https://aistudio.google.com", why: "Free Gemini access." },
  { name: "Ollama", category: "ai", url: "https://ollama.com", why: "Run LLMs locally for free." },

  // Docs & collab
  { name: "Notion (Free)", category: "docs", url: "https://notion.so", why: "Free personal docs/notes/knowledge base." },
  { name: "Obsidian", category: "docs", url: "https://obsidian.md", why: "Free local-first markdown notes." },
  { name: "GitBook (Free)", category: "docs", url: "https://gitbook.com", why: "Free public documentation hosting." },
  { name: "Slack (Free)", category: "collab", url: "https://slack.com", why: "Free team chat." },
  { name: "Discord", category: "collab", url: "https://discord.com", why: "Free voice/text/community." },

  // Monitoring
  { name: "Sentry (Free)", category: "monitoring", url: "https://sentry.io", why: "Free error tracking, 5k events/mo." },
  { name: "Better Stack (Free)", category: "monitoring", url: "https://betterstack.com", why: "Free uptime + log monitoring." },
  { name: "UptimeRobot", category: "monitoring", url: "https://uptimerobot.com", why: "Free uptime pings every 5 min." },
];

export function toolsByCategory(cat: ToolCategory): ToolEntry[] {
  return TOOLS.filter((t) => t.category === cat);
}
