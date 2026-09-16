import type { ReactNode } from "react";

/** Small, backwards-compatible Markdown subset. Text is escaped by React; no HTML. */
export function ThoughtText({ text, links = true }: { text: string; links?: boolean }) {
  const parts: ReactNode[] = [];
  const pattern = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(cursor, match.index));
    const key = match.index;
    if (match[1]) parts.push(<strong key={key}>{match[1]}</strong>);
    else if (match[2]) parts.push(<em key={key}>{match[2]}</em>);
    else parts.push(links ? <a key={key} href={match[4]} target="_blank" rel="noopener noreferrer">{match[3]}</a> : <span key={key} className="thought-link-preview">{match[3]}</span>);
    cursor = match.index + match[0].length;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
