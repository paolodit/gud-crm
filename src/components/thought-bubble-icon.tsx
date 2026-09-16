import { createLucideIcon } from "lucide-react";

// A cloud-shaped thought balloon with two small trailing bubbles.
export const ThoughtBubble = createLucideIcon("ThoughtBubble", [
  ["path", { d: "M7 16a4 4 0 0 1-3-6.6A4 4 0 0 1 9 4a4.5 4.5 0 0 1 7.6 1.2A4 4 0 0 1 21 11a4 4 0 0 1-5 5 4.5 4.5 0 0 1-6 0Z", key: "balloon" }],
  ["circle", { cx: "6", cy: "19", r: "1.2", key: "bubble" }],
  ["circle", { cx: "2.5", cy: "21.5", r: ".5", key: "tail" }],
]);
