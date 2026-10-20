import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Moon, Sun } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Yani" },
      { name: "description", content: "Manage your account, theme and preferences." },
      { property: "og:title", content: "Settings — Yani" },
      { property: "og:description", content: "Manage your account, theme and preferences." },
      { property: "og:url", content: "https://yani-follow-projects.yani.app/settings" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">(
    typeof window !== "undefined" && document.documentElement.classList.contains("light") ? "light" : "dark",
  );

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setEmail(data.user.email ?? "");
      const { data: p } = await supabase.from("profiles").select("full_name").eq("id", data.user.id).single();
      setFullName(p?.full_name ?? "");
    });
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("freepm-theme");
    if (saved === "light") document.documentElement.classList.add("light");
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("light", next === "light");
    localStorage.setItem("freepm-theme", next);
  }

  async function saveProfile() {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;
    const { error } = await supabase.from("profiles").upsert({ id: user.user.id, full_name: fullName });
    if (error) toast.error(error.message);
    else toast.success("Saved");
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6 md:p-8">
      <h1 className="text-3xl font-semibold">Settings</h1>

      <Card className="space-y-4 p-6">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={email} disabled />
        </div>
        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <Button onClick={saveProfile}>Save profile</Button>
      </Card>

      <Card className="flex items-center justify-between p-6">
        <div>
          <div className="font-medium">Appearance</div>
          <div className="text-sm text-muted-foreground">Toggle dark / light theme.</div>
        </div>
        <Button variant="outline" onClick={toggleTheme} className="gap-2">
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {theme === "dark" ? "Light" : "Dark"}
        </Button>
      </Card>

      <Card className="flex items-center justify-between p-6">
        <div>
          <div className="font-medium">Sign out</div>
          <div className="text-sm text-muted-foreground">End your session on this device.</div>
        </div>
        <Button variant="destructive" onClick={signOut}>Sign out</Button>
      </Card>
    </div>
  );
}
