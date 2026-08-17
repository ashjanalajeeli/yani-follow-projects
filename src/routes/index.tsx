import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, Rocket, ListChecks, Wand2, GitBranch, FileStack } from "lucide-react";
import { Button } from "@/components/ui/button";

const SITE = "https://freeflow-projects.lovable.app";
const HOME_TITLE = "Yani — Free AI Project Management for Devs";
const HOME_DESC =
  "Turn any idea or brief into a full AI roadmap: stages, tasks, subtasks, free tool picks and ready-to-use AI prompts. Free forever.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: HOME_TITLE },
      { name: "description", content: HOME_DESC },
      { property: "og:title", content: HOME_TITLE },
      { property: "og:description", content: HOME_DESC },
      { property: "og:url", content: `${SITE}/` },
      { property: "og:image", content: `${SITE}/og-image.jpg` },
      { name: "twitter:image", content: `${SITE}/og-image.jpg` },
    ],
    links: [{ rel: "canonical", href: `${SITE}/` }],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 glass">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </div>
            Yani
          </Link>
          <nav className="flex items-center gap-2">
            <Link to="/auth">
              <Button variant="ghost" size="sm">Sign in</Button>
            </Link>
            <Link to="/auth">
              <Button size="sm">Get started free</Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pt-20 pb-16 text-center">
        <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" /> AI project management for developers — 100% free
        </div>
        <h1 className="mx-auto max-w-3xl text-5xl font-bold leading-tight tracking-tight sm:text-6xl">
          Turn any idea into a <span className="gradient-text">complete roadmap</span> in seconds.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          Drop in a brief or upload a proposal. Yani analyzes the project, generates
          stages, tasks, subtasks, and AI prompts — with free tools recommended for every step.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/auth">
            <Button size="lg" className="gap-2">
              <Rocket className="size-4" /> Start a project
            </Button>
          </Link>
          <a href="#features">
            <Button size="lg" variant="outline">See features</Button>
          </a>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-4 pb-24">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-border/60 bg-card p-6 transition hover:border-primary/50">
              <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
                <f.icon className="size-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border/60 py-8">
        <div className="mx-auto max-w-6xl px-4 text-center text-sm text-muted-foreground">
          Built for developers who ship. Free forever.
        </div>
      </footer>
    </div>
  );
}

const FEATURES = [
  { icon: Wand2, title: "AI Project Analysis", body: "Detects project type, tech stack, risks, and effort — from your idea or docs." },
  { icon: GitBranch, title: "Smart Roadmap", body: "13 stages from Planning to Maintenance, each with realistic tasks and dependencies." },
  { icon: ListChecks, title: "Micro Tasks & Subtasks", body: "Every task broken into steps you can knock out one at a time." },
  { icon: Sparkles, title: "AI Prompts Per Task", body: "Prompts ready for ChatGPT, Claude, Gemini, Cursor, Replit, Lovable and Figma Make." },
  { icon: FileStack, title: "Free Tool Picks", body: "Curated free tools for design, backend, hosting, testing — no upsell." },
  { icon: Rocket, title: "Kanban & Timeline", body: "Track progress with a live Kanban board, weekly timeline and health signals." },
];
