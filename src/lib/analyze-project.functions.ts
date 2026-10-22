import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callGatewayJson } from "./ai-gateway.server";
import { STAGE_TEMPLATE, PROMPT_TARGETS } from "./stage-templates";
import { TOOLS } from "./tools-catalog";

// ---------- Types the AI is asked to return ----------
interface AnalysisJson {
  project_type: string;
  complexity: "low" | "medium" | "high";
  tech_stack: string[];
  suggested_architecture: string;
  required_apis: string[];
  database: string;
  authentication: string;
  admin_dashboard: string;
  hosting: string;
  risks: string[];
  missing_requirements: string[];
  estimated_hours: number;
  estimated_cost_usd: number;
  weeks_timeline: number;
  summary: string;
}

interface StagePlan {
  key: string;
  tasks: Array<{
    title: string;
    description: string;
    estimated_hours: number;
    difficulty: "easy" | "medium" | "hard";
    priority: "low" | "medium" | "high";
    expected_output: string;
    subtasks: string[];
    tool_categories: string[]; // e.g. ["design","frontend"]
    learning: {
      what: string;
      why: string;
      how: string;
    };
  }>;
  checklist: string[];
}

// ---------- Analyze ----------
export const analyzeProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: project, error } = await supabase
      .from("projects")
      .select("*, project_files(name, parsed_text)")
      .eq("id", data.projectId)
      .eq("owner_id", userId)
      .single();
    if (error || !project) throw new Error("Project not found");

    const { data: claimed, error: claimError } = await supabase
      .from("projects")
      .update({ generation_status: "analyzing" })
      .eq("id", project.id)
      .eq("generation_status", "pending")
      .select("id")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) throw new Error("Analysis has already started or completed for this project.");

    try {
      const docExcerpts = (
        (project.project_files as Array<{ name: string; parsed_text: string | null }>) ?? []
      )
        .filter((f) => f.parsed_text)
        .slice(0, 6)
        .map((f) => `--- ${f.name} ---\n${(f.parsed_text ?? "").slice(0, 4000)}`)
        .join("\n\n");

      const analysisPrompt = `You are a senior software architect. Analyze this software project and return ONLY valid JSON matching this shape:
{
  "project_type": string, "complexity": "low"|"medium"|"high",
  "tech_stack": string[], "suggested_architecture": string,
  "required_apis": string[], "database": string,
  "authentication": string, "admin_dashboard": string, "hosting": string,
  "risks": string[], "missing_requirements": string[],
  "estimated_hours": number, "estimated_cost_usd": number, "weeks_timeline": number,
  "summary": string
}
Recommend ONLY free tools/technologies. Be concrete.

PROJECT NAME: ${project.name}
DESCRIPTION: ${project.description ?? ""}
IDEA / BRIEF:
${project.idea_text ?? ""}

${docExcerpts ? `UPLOADED DOCUMENTS:\n${docExcerpts}` : ""}`;

      const analysis = await callGatewayJson<AnalysisJson>([
        {
          role: "system",
          content: "You are a senior software architect who returns only valid JSON.",
        },
        { role: "user", content: analysisPrompt },
      ]);

      await supabase
        .from("projects")
        .update({
          analysis: JSON.parse(JSON.stringify(analysis)),
          tech_stack: JSON.parse(JSON.stringify(analysis.tech_stack)),
          project_type: analysis.project_type,
          complexity: analysis.complexity,

          estimated_hours: analysis.estimated_hours,
          estimated_cost: analysis.estimated_cost_usd,
          generation_status: "roadmap",
        })
        .eq("id", project.id);

      await supabase.from("activity_log").insert({
        project_id: project.id,
        user_id: userId,
        action: "analysis_ready",
      });

      // Build stages first (from template), then have AI populate tasks per stage.
      const stageRows = STAGE_TEMPLATE.map((s, i) => ({
        project_id: project.id,
        key: s.key,
        name: s.name,
        description: s.description,
        order_index: i,
      }));
      const { data: stages, error: stagesErr } = await supabase
        .from("stages")
        .insert(stageRows)
        .select();
      if (stagesErr) throw stagesErr;

      // Ask AI for full roadmap in one go (compact per-stage output).
      const roadmapPrompt = `Given this project analysis, generate a detailed roadmap.
Return ONLY JSON: { "stages": StagePlan[] } where each stage matches:
{
  "key": one of ${JSON.stringify(STAGE_TEMPLATE.map((s) => s.key))},
  "tasks": [ {
    "title": string, "description": string,
    "estimated_hours": number, "difficulty": "easy"|"medium"|"hard",
    "priority": "low"|"medium"|"high",
    "expected_output": string,
    "subtasks": string[],
    "tool_categories": string[] (from: design, backend, database, frontend, hosting, auth, storage, testing, devtools, ai, docs, collab, monitoring),
    "learning": { "what": string, "why": string, "how": string }
  } ],
  "checklist": string[]
}
Include 3-6 tasks per stage. Subtasks: 3-6 each. Keep it practical for a beginner.

ANALYSIS:
${JSON.stringify(analysis)}
PROJECT: ${project.name} — ${project.description ?? ""}`;

      const roadmap = await callGatewayJson<{ stages: StagePlan[] }>(
        [
          { role: "system", content: "You return only valid compact JSON. No commentary." },
          { role: "user", content: roadmapPrompt },
        ],
        { model: "google/gemini-3-flash-preview" },
      );

      const stageByKey = new Map(stages!.map((s) => [s.key, s.id]));

      for (const sp of roadmap.stages ?? []) {
        const stageId = stageByKey.get(sp.key);
        if (!stageId) continue;

        // Checklist
        if (sp.checklist?.length) {
          await supabase
            .from("checklists")
            .insert(sp.checklist.map((item, i) => ({ stage_id: stageId, item, order_index: i })));
        }

        for (const [idx, t] of (sp.tasks ?? []).entries()) {
          const { data: task, error: terr } = await supabase
            .from("tasks")
            .insert({
              project_id: project.id,
              stage_id: stageId,
              title: t.title,
              description: t.description,
              estimated_hours: t.estimated_hours,
              difficulty: t.difficulty,
              priority: t.priority,
              expected_output: t.expected_output,
              order_index: idx,
              learning_notes: t.learning,
            })
            .select()
            .single();
          if (terr || !task) continue;

          if (t.subtasks?.length) {
            await supabase
              .from("subtasks")
              .insert(t.subtasks.map((title, i) => ({ task_id: task.id, title, order_index: i })));
          }

          // Tools from curated catalog
          const toolRows = (t.tool_categories ?? [])
            .flatMap((cat) =>
              TOOLS.filter((tool) => tool.category === cat)
                .slice(0, 3)
                .map((tool) => ({
                  task_id: task.id,
                  tool_name: tool.name,
                  category: tool.category,
                  url: tool.url,
                  why: tool.why,
                })),
            )
            .slice(0, 8);
          if (toolRows.length) await supabase.from("task_tools").insert(toolRows);

          // AI prompts (template-generated to avoid extra AI cost)
          const promptRows = PROMPT_TARGETS.map((target) => ({
            task_id: task.id,
            target,
            prompt_text: buildPrompt(
              target,
              project.name,
              t.title,
              t.description,
              t.expected_output,
            ),
          }));
          await supabase.from("task_prompts").insert(promptRows);
        }
      }

      await supabase.from("projects").update({ generation_status: "ready" }).eq("id", project.id);
      await supabase.from("activity_log").insert({
        project_id: project.id,
        user_id: userId,
        action: "roadmap_ready",
      });

      return { ok: true };
    } catch (analysisError) {
      await supabase.from("projects").update({ generation_status: "failed" }).eq("id", project.id);
      throw analysisError;
    }
  });

function buildPrompt(
  target: string,
  projectName: string,
  taskTitle: string,
  taskDescription: string,
  expected: string,
): string {
  const base = `Project: ${projectName}\nTask: ${taskTitle}\n\nContext: ${taskDescription}\n\nExpected output: ${expected}`;
  switch (target) {
    case "cursor":
    case "yani":
    case "replit":
      return `You are pair-programming inside ${target}. Implement the task below step by step. Ask before making destructive changes.\n\n${base}\n\nDeliverables:\n- Code that compiles\n- Short summary of what you changed\n- Tests where relevant`;
    case "figma":
      return `Design brief for Figma / Figma Make.\n\n${base}\n\nProduce:\n- Screen layout\n- Component list\n- Interaction notes`;
    default:
      return `You are a senior engineer helping me with a real project. Explain like I'm a beginner.\n\n${base}\n\nPlease:\n1. Break the work into steps I can follow.\n2. Give me the exact code (with file paths).\n3. List anything I might get stuck on.`;
  }
}
