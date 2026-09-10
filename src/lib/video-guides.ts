// Titles, publishers and thumbnails verified with YouTube oEmbed on 2026-09-10.
// Keep this editorial list small: every entry needs a clear reason to watch.
export const videoGuides = [
  {
    id: "lwipfn9znk0", topic: "Client conversations", speaker: "Chris Do", publisher: "The Futur",
    title: "Watch This Before Your Next Client Call Or Regret It Later",
    reason: "A short reset before a first call: discuss money, ask better questions and help the client decide whether you fit.",
  },
  {
    id: "J6Su5Vx3x5U", topic: "Pricing", speaker: "Blair Enns", publisher: "The Futur",
    title: "Pricing Creativity w/ Blair Enns Livestream",
    reason: "A deeper conversation about pricing creative expertise around client value, rather than hours and deliverables.",
  },
  {
    id: "-VqmFI9vY7w", topic: "Positioning & pitches", speaker: "April Dunford", publisher: "Lenny’s Podcast",
    title: "A step-by-step guide to crafting a sales pitch that wins | April Dunford (author of Sales Pitch)",
    reason: "Structure a pitch around the buyer’s alternatives and your differentiated value. Product-led examples; useful principles for service offers too.",
  },
  {
    id: "pc66141WYEI", topic: "Client conversations", speaker: "Chris Do", publisher: "The Futur",
    title: "Watch This Before Your Next Sales Call— 60 Minute Sales Crash Course",
    reason: "Set aside time to rethink the conversation: listen, diagnose and help, instead of rushing to sell a solution.",
  },
  {
    id: "sfyHSbfUCrQ", topic: "Pricing", speaker: "Blair Enns", publisher: "The Futur",
    title: "Why You Must Raise Your Price (Clubhouse WWPM XI w/ Blair Enns)",
    reason: "Challenge the habit of keeping fees static as your expertise and impact grow. Best watched before reviewing your pricing.",
  },
  {
    id: "hdjlCLb9Hl8", topic: "Positioning & pitches", speaker: "April Dunford", publisher: "Lenny’s Podcast",
    title: "How to nail your product positioning | April Dunford (Obviously Awesome)",
    reason: "Clarify who values what you do and what they would choose instead. A product-positioning lens to apply thoughtfully to your own offer.",
  },
] as const;

export type VideoGuide = (typeof videoGuides)[number];
