import {
  CalendarCheck,
  FileCheck,
  Mail,
  MessageSquare,
  NotebookPen,
  Package,
  Phone,
} from "lucide-react";

import type { Channel } from "@/lib/domain/types";

export function ChannelIcon({ channel, size = 14 }: { channel: Channel; size?: number }) {
  const Icon = {
    linkedin: MessageSquare,
    email: Mail,
    phone: Phone,
    meeting: CalendarCheck,
    physical: Package,
    note: NotebookPen,
  }[channel];
  return <Icon size={size} aria-hidden="true" />;
}

export function ActivityIcon({ icon, size = 14 }: { icon: string; size?: number }) {
  const Icon =
    {
      MessageSquare,
      Mail,
      Phone,
      CalendarCheck,
      Package,
      FileCheck,
      NotebookPen,
    }[icon] ?? NotebookPen;
  return <Icon size={size} aria-hidden="true" />;
}
