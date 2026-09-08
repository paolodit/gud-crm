"use client";
import type { ReactNode } from "react";

/** Animated expansion keeps form drafts intact while making closed content inert. */
export function AnimatedReveal({ open, children }: { open: boolean; children: ReactNode }) {
  return <div className="animated-reveal" data-open={open} inert={!open} aria-hidden={!open}><div>{children}</div></div>;
}
