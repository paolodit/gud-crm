"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserRound } from "lucide-react";
import { saveSoloModeAction } from "@/app/actions/workspace";

export function SoloModeSetting({ enabled, canEdit }: { enabled: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(enabled);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function change(next: boolean) {
    const previous = value;
    setValue(next); setPending(true); setMessage("");
    try {
      const result = await saveSoloModeAction({ soloMode: next });
      if (!result.ok) { setValue(previous); setMessage(result.error); return; }
      setValue(next); setMessage("Working mode saved."); router.refresh();
    } catch { setValue(previous); setMessage("Could not save. Please try again."); }
    finally { setPending(false); }
  }
  return <><div className="settings-icon"><UserRound /></div><div><h2>Who uses this workspace?</h2><p>Keep ownership out of the way when you work alone.</p></div><label className="check-row settings-wide"><input type="checkbox" checked={value} disabled={pending || !canEdit} onChange={(event) => void change(event.target.checked)} /><span><strong>It’s just me!</strong><small>Hide owner filters, assignments and owner fields on Pipeline and Live projects. Existing assignments are preserved; switch this off any time for team working.</small></span></label>{message ? <p className="settings-hint" role="status">{message}</p> : null}</>;
}
