"use client";
import { useEffect, useRef } from "react";
import { toolArguments } from "@/lib/gud-actions/contract";
import type { z } from "zod";

export type PageControl = z.infer<typeof toolArguments.page_control>;
type Controls = { page: PageControl["page"]; data: unknown; run: (request: PageControl) => unknown | Promise<unknown> };
let active: Controls | undefined;
/** Explicit page-owned actions only; never execute arbitrary selectors or code. */
export function useGudPage(page: Controls["page"], data: unknown, run: Controls["run"]) {
  const current = useRef<Controls>({ page, data, run });
  useEffect(() => { current.current = { page, data, run }; active = current.current; });
  useEffect(() => () => { if (active === current.current) active = undefined; }, []);
}
export function gudPageContext() {
  return active ? JSON.stringify({ page: active.page, data: active.data }).slice(0, 24000) : undefined;
}
export async function runGudPageControl(raw: unknown) {
  const request = toolArguments.page_control.parse(raw);
  if (!active || active.page !== request.page) throw new Error("Open that page first, then ask for its controls.");
  if (request.action === "read") return { page: active.page, data: active.data };
  return await active.run(request);
}
export function requestIdeaConversation(id?: string) {
  window.dispatchEvent(new CustomEvent("gud:conversation-open", { detail: { ideaId: id ?? null, guidedIdea: true } }));
}
