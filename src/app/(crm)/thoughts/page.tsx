import { loadThoughtsAction } from "@/app/actions/thoughts";
import { ThoughtsBoard } from "@/components/thoughts-board";
import "./thoughts.css";

export const dynamic = "force-dynamic";
export default async function ThoughtsPage() {
  const result = await loadThoughtsAction();
  if (!result.ok) return <section className="workspace-page"><h1>Thoughts</h1><p role="alert">{result.error}</p><p>Thoughts is a personal space, never a shared CRM board.</p></section>;
  return <ThoughtsBoard initial={result} />;
}
