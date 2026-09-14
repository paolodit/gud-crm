const targetIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Return navigation is restricted to a target ID, never a user-supplied URL. */
export function emailFindingReturnHref(targetId: string | null | undefined) {
  return targetId && targetIdPattern.test(targetId) ? `/targets?target=${encodeURIComponent(targetId)}` : null;
}

export function emailFindingSettingsHref(targetId?: string | null) {
  const params = new URLSearchParams({ tab: "ai", section: "email-finding" });
  if (emailFindingReturnHref(targetId)) params.set("returnTarget", targetId!);
  return `/settings?${params.toString()}#email-finding`;
}
