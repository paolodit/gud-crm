/** Decorative, code-native artwork: never part of the page's reading order. */
export function BoardHeaderArt({ kind }: { kind: "pipeline" | "delivery" }) {
  return <svg className="board-header-art" data-kind={kind} viewBox="0 0 640 160" fill="none" aria-hidden="true" focusable="false">
    {kind === "pipeline" ? <g stroke="currentColor" strokeWidth="1.5">
      <path d="M18 122H135Q153 122 153 104V92Q153 74 171 74H304Q322 74 322 56V48Q322 30 340 30H510" />
      <path d="m498 18 12 12-12 12" />
      <rect x="50" y="95" width="72" height="54" rx="8" fill="currentColor" fillOpacity=".15" />
      <rect x="207" y="47" width="72" height="54" rx="8" fill="currentColor" fillOpacity=".15" />
      <rect x="367" y="3" width="72" height="54" rx="8" fill="currentColor" fillOpacity=".15" />
      <path d="M64 109h28m-28 10h42m115-58h28m-28 10h42m115-54h28m-28 10h42" />
      <circle cx="557" cy="30" r="20" /><path d="m548 30 6 6 13-13" />
    </g> : <g stroke="currentColor" strokeWidth="1.5">
      <path d="M32 30h550M32 78h550M32 126h550" strokeDasharray="3 9" />
      <path d="M85 10v140m140-140v140m140-140v140m140-140v140" strokeOpacity=".45" />
      <rect x="50" y="19" width="146" height="22" rx="7" fill="currentColor" fillOpacity=".2" />
      <rect x="210" y="67" width="170" height="22" rx="7" fill="currentColor" fillOpacity=".2" />
      <rect x="393" y="115" width="132" height="22" rx="7" fill="currentColor" fillOpacity=".2" />
      <path d="M196 30h14v48m170 0h13v48" /><path d="m548 126 9 9 17-18" />
    </g>}
  </svg>;
}
