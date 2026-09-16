"use client";
import { useRef, useState } from "react";
import { Bold, Italic, Link as LinkIcon } from "lucide-react";
import { ThoughtText } from "./thought-text";

export function ThoughtBodyEditor({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState("");
  const selection = useRef({ start: 0, end: 0 });
  function insert(before: string, after: string) {
    const { start, end } = selection.current;
    const selected = value.slice(start, end) || "text";
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    if (next.length > 20000) { setError("Keep the thought within 20,000 characters."); return; }
    onChange(next); setError("");
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(start + before.length, start + before.length + selected.length); });
  }
  function remember() { selection.current = { start: input.current?.selectionStart ?? 0, end: input.current?.selectionEnd ?? 0 }; }
  return <div className="thought-body-editor">
    <div className="thought-format-toolbar" role="toolbar" aria-label="Text formatting">
      <button type="button" className="icon-button" aria-label="Bold" title="Bold" disabled={disabled} onMouseDown={remember} onClick={() => insert("**", "**")}><Bold size={16} /></button>
      <button type="button" className="icon-button" aria-label="Italic" title="Italic" disabled={disabled} onMouseDown={remember} onClick={() => insert("*", "*")}><Italic size={16} /></button>
      <button type="button" className="icon-button" aria-label="Add link" title="Add link" disabled={disabled} onMouseDown={remember} onClick={() => setLink("https://")}><LinkIcon size={16} /></button>
      <small>Select text to format</small>
    </div>
    {link !== null ? <div className="thought-link-entry"><input aria-label="Link URL" value={link} placeholder="https://…" onChange={e => setLink(e.target.value)} /><button className="btn btn-quiet" type="button" onClick={() => { try { const url = new URL(link); if (!["https:", "http:"].includes(url.protocol) || /[\s)]/.test(link)) throw new Error(); insert("[", `](${url.href})`); setLink(null); } catch { setError("Use a valid http or https link."); } }}>Insert link</button><button type="button" className="btn btn-quiet" onClick={() => { setLink(null); setError(""); }}>Cancel</button></div> : null}
    <textarea ref={input} aria-label="Thought" data-autofocus rows={5} maxLength={20000} placeholder="Write your thought…" value={value} onSelect={remember} onChange={e => onChange(e.target.value)} disabled={disabled} />
    {error ? <p role="alert">{error}</p> : null}
    {value && /\*|\]\(/.test(value) ? <div className="thought-text-preview" aria-label="Formatted preview"><ThoughtText text={value} /></div> : null}
  </div>;
}
