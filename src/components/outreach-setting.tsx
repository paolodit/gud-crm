"use client";

import { Phone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { saveOutreachSettingAction } from "@/app/actions/outreach";

export function OutreachSetting({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [value, setValue] = useState(enabled);

  async function change(next: boolean) {
    const previous = value;
    setValue(next);
    setPending(true);
    setError("");
    try {
      const result = await saveOutreachSettingAction(next);
      if (!result.ok) {
        setValue(previous);
        return setError(result.error ?? "Could not update Outreach.");
      }
      router.refresh();
    } catch {
      setValue(previous);
      setError("Could not update Outreach. Try again.");
    } finally {
      setPending(false);
    }
  }

  return <>
    <div className="settings-icon"><Phone /></div>
    <div><h2>Outreach</h2><p>Prepare a call list and use the HSM App scripts during a session.</p></div>
    <label className="check-row settings-wide"><input type="checkbox" checked={value} disabled={pending} onChange={(event) => void change(event.target.checked)} />Enable Outreach for this workspace</label>
    {error && <p className="form-error" role="alert">{error}</p>}
  </>;
}
