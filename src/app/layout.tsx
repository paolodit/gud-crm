import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "GUD Sales Workspace",
  description: "A focused sales workspace for understanding prospects, choosing the next action and turning opportunities into revenue.",
  icons: {
    icon: "/gud-crm-logo.png",
    apple: "/gud-crm-logo.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
