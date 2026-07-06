# FreePM — AI Project Management for Dev Agencies & Freelancers

A free, AI-powered PM app (Jira + Trello + ClickUp + Notion vibe) that turns a project idea or uploaded docs into a full roadmap: stages → tasks → subtasks → free-tool recommendations → AI prompts → tracking → deployment.

Per your instruction, this turn is **planning only** — no code yet. Approve or tweak, then I'll build in phases.

---

## 1. Tech Stack (all free)

- **Frontend**: React 19 + TanStack Start (already scaffolded) + Tailwind v4 + shadcn/ui
- **Backend/DB/Auth/Storage**: Lovable Cloud (Supabase under the hood — Postgres, Auth, Storage, Edge functions) — free tier
- **AI**: Lovable AI Gateway (`google/gemini-3-flash-preview` default) — free monthly allowance
- **Doc parsing**: `unpdf` (PDF), `mammoth` (DOCX), Tesseract.js (OCR images) — all free
- **Charts**: Recharts. **DnD Kanban**: `@dnd-kit`. **Calendar**: `react-day-picker`. **Markdown**: `react-markdown`.
- **Export**: `jspdf`, `xlsx`, native JSON/CSV/MD
- **Hosting**: Lovable publish (free)

## 2. Database Schema (Postgres)

```text
profiles(id→auth.users, full_name, avatar_url, role)
user_roles(user_id, role: admin|member)         -- security-definer has_role()
clients(id, owner_id, name, email, company, phone, notes)
projects(id, owner_id, client_id?, name, description, type, complexity,
         status, priority, health, progress, start_date, due_date,
         estimated_hours, estimated_cost, tech_stack jsonb, analysis jsonb)
milestones(id, project_id, name, due_date, order_index, completed)
stages(id, project_id, key, name, order_index, status, progress)
   -- keys: planning, research, design, db, backend, frontend, api,
   --       auth, admin, testing, deployment, launch, maintenance
tasks(id, stage_id, project_id, title, description, status,
      priority, difficulty, estimated_hours, actual_hours,
      due_date, assignee_id, order_index, dependencies uuid[],
      expected_output, learning_notes jsonb)
subtasks(id, task_id, title, done, order_index)
task_tools(id, task_id, tool_name, category, url, why)
task_prompts(id, task_id, target: chatgpt|claude|gemini|cursor|replit|lovable|figma,
             prompt_text)
task_files(id, task_id, project_id, name, path, mime, size, uploaded_by)
project_documents(id, project_id, kind, name, path, mime, parsed_text)
meetings(id, client_id, project_id?, title, starts_at, notes)
invoices(id, client_id, project_id?, number, amount, currency, status, due_date, pdf_path)
payments(id, invoice_id, amount, paid_at, method)
contracts(id, client_id, project_id?, name, path, signed_at)
messages(id, client_id, project_id?, sender_id, body, created_at)
notifications(id, user_id, type, title, body, link, read, created_at)
activity_log(id, project_id, user_id, action, meta jsonb, created_at)
time_entries(id, task_id, user_id, minutes, note, logged_at)
checklists(id, stage_id, item, done)             -- AI "ready for next stage"
```

RLS: everything scoped to `owner_id = auth.uid()`; roles via `has_role()`. Storage buckets: `project-docs` (private), `task-files` (private), `avatars` (public).

## 3. Folder Structure

```text
src/
  routes/
    __root.tsx
    index.tsx                        # marketing landing
    auth.tsx                         # sign in / up
    _authenticated/
      route.tsx                      # gate
      dashboard.tsx                  # global overview
      projects.index.tsx             # project list
      projects.new.tsx               # idea OR upload → analyze
      projects.$id.tsx               # project shell (tabs)
      projects.$id.overview.tsx
      projects.$id.roadmap.tsx       # stages + timeline
      projects.$id.kanban.tsx
      projects.$id.tasks.$taskId.tsx # task detail (subtasks, tools, prompts, files, learn)
      projects.$id.files.tsx
      projects.$id.docs.tsx
      projects.$id.checklist.tsx
      projects.$id.export.tsx
      clients.index.tsx / clients.$id.tsx
      invoices / meetings / contracts / messages
      notifications.tsx
      settings.tsx
    api/
      chat.ts                        # AI assistant stream
  components/
    ui/ (shadcn), layout/, dashboard/, project/, kanban/, timeline/,
    tasks/, files/, clients/, ai/, charts/
  lib/
    ai-gateway.server.ts
    analyze-project.functions.ts     # idea/docs → analysis + roadmap
    generate-roadmap.functions.ts
    generate-tasks.functions.ts
    generate-prompts.functions.ts
    parse-document.functions.ts      # PDF/DOCX/image → text
    export.functions.ts              # pdf/xlsx/md/json/csv
    tools-catalog.ts                 # curated free tools per category
  hooks/  utils/  styles.css
supabase/migrations/…
```

## 4. AI Pipeline

1. **Ingest**: idea text and/or uploaded files → `parse-document` extracts text (unpdf/mammoth/tesseract).
2. **Analyze** (`analyze-project`): Gemini returns structured JSON — type, complexity, tech stack, architecture, APIs, DB, auth, risks, missing requirements, cost/time estimates. Small Zod schema, no bounds (per SDK rules).
3. **Clarify**: if `missing_requirements` non-empty → in-app question wizard before roadmap.
4. **Roadmap** (`generate-roadmap`): produces stages (from the 13 fixed keys), milestones, weekly timeline.
5. **Tasks & subtasks** (`generate-tasks`): per stage → tasks → subtasks with hours/difficulty/priority/deps/expected output/learning notes.
6. **Tools + Prompts** (`generate-prompts`): for each task attach recommended free tools (from curated catalog + AI additions) and prompt variants for ChatGPT/Claude/Gemini/Cursor/Replit/Lovable/Figma.
7. **Checklists**: per stage AI checklist for "ready for next stage".
8. **Assistant**: chat route with project context (streaming).

All heavy generation runs in `createServerFn` with progress written to `activity_log` so the UI can show a live "Generating your roadmap…" state.

## 5. Screens (MVP scope)

Dashboard · Projects list · New Project (idea OR upload) · Project Overview (progress, health, cost, time) · Roadmap/Timeline · Kanban (Todo/In Progress/Review/Testing/Done) · Task Detail (subtasks, tools, prompts, files, learn) · Files · Documents · Checklist · Clients/Invoices/Meetings/Contracts/Messages · Notifications · Export · Settings (theme, profile).

UI: dark + light, minimal, shadcn tokens, Recharts for progress/burn-down, dnd-kit Kanban, weekly timeline grid.

## 6. Build Phases

1. **Foundation**: enable Cloud, design system (dark+light), auth (email + Google), `_authenticated` gate, layout shell, landing.
2. **Schema + RLS**: all tables, roles, storage buckets, policies, grants.
3. **Projects CRUD + New Project wizard**: idea input, file upload, doc parsing.
4. **AI analysis + roadmap generation**: server fns, progress UI, clarify wizard.
5. **Task system**: stages, tasks, subtasks, tools, prompts, files, learning notes.
6. **Kanban + Timeline + Dashboard charts**.
7. **Clients / Invoices / Meetings / Contracts / Messages**.
8. **Checklists + Notifications + Activity log**.
9. **AI Assistant chat**.
10. **Export (PDF/XLSX/MD/JSON/CSV)** + polish + SEO + sitemap.

## 7. Questions before I build

1. **Scope for v1**: ship all 16 features now, or start with core (Projects + AI analysis + Roadmap + Tasks + Kanban + Files + AI prompts) and add Clients/Invoices/Meetings/Contracts/Messages in phase 2? Recommend the latter to keep quality high.
2. **Auth**: email + password only, or email + Google? (Google is free and one extra step.)
3. **Multi-user teams** or single-user (you own everything)? Multi-user adds invites + team scoping.
4. **Visual direction**: Linear-style (dense, mono-accent, dark-first), Notion-style (soft, airy, light-first), or ClickUp-style (colorful, playful)?

Reply with answers (or "go with your recommendation") and I'll start Phase 1.
