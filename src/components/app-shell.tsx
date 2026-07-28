"use client";

import {
  BarChart3,
  Building2,
  LayoutDashboard,
  ListChecks,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sparkles,
  Telescope,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import type { CurrentMember } from "@/lib/session";
import { BrandLogo } from "@/components/brand-logo";

const navItems = [
  { href: "/pipeline", label: "Pipeline", icon: LayoutDashboard },
  { href: "/my-work", label: "Today", icon: ListChecks },
  { href: "/research", label: "Research", icon: Telescope },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/search", label: "Search", icon: Search },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];

export function AppShell({ member, instanceName, children }: { member: CurrentMember; instanceName: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setSidebarCollapsed(window.localStorage.getItem("gud-crm-sidebar-collapsed") === "true");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((value) => {
      const next = !value;
      window.localStorage.setItem("gud-crm-sidebar-collapsed", String(next));
      return next;
    });
  }

  async function signOut() {
    if (member.storageMode !== "postgres") {
      router.push("/sign-in");
      return;
    }
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <div className="app-layout" data-sidebar-collapsed={sidebarCollapsed}>
      <aside className="sidebar">
        <div className="brand">
          <BrandLogo size={44} priority />
          <div className="brand-copy">
            <strong>GUD Sales</strong>
            <span>{instanceName}</span>
          </div>
          <button className="sidebar-toggle" type="button" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"} title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}>
            {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>

        <nav className="side-nav" aria-label="Primary navigation">
          {navItems.map(({ href, label, icon: Icon }, index) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <span key={href} style={{ display: "contents" }}>
                {index === 3 ? <span className="nav-spacer" aria-hidden="true" /> : null}
                <Link href={href} aria-current={active ? "page" : undefined}>
                  <Icon size={18} aria-hidden="true" />
                  <span>{label}</span>
                </Link>
              </span>
            );
          })}
          <span className="nav-spacer" aria-hidden="true" />
          <Link href="/playbook" aria-current={pathname === "/playbook" ? "page" : undefined}>
            <Sparkles size={18} aria-hidden="true" />
            <span>Playbook</span>
          </Link>
          {member.role === "admin" ? (
            <Link href="/settings" aria-current={pathname === "/settings" ? "page" : undefined}>
              <Settings size={18} aria-hidden="true" />
              <span>Settings</span>
            </Link>
          ) : null}
        </nav>

        <div className="side-footer">
          <div className="member-row">
            <div className="avatar">{initials(member.name)}</div>
            <div className="member-meta">
              <strong>{member.name}</strong>
              <span>{member.storageMode === "sqlite" ? "Local SQLite" : member.demoMode ? "Demo workspace" : member.role}</span>
            </div>
            <button className="icon-button-dark" type="button" onClick={signOut} aria-label="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="page-main">{children}</main>
    </div>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
