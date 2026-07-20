import { coreOffer } from "@/lib/domain/offers";
import type { EditionDefinition } from "@/lib/editions/types";

export const focusedEdition: EditionDefinition = {
  key: "focused",
  name: "Focused Sales",
  shortName: "Focused",
  audience: "Single-product, SaaS and focused-offer sales teams",
  description: "A focused pipeline for teams selling one main product or a tightly connected product family.",
  pipelineName: "Focused Sales",
  defaultOffer: coreOffer,
  stageNames: [
    "Researching",
    "Research holding",
    "Ready to contact",
    "Outreach active",
    "Engaged",
    "Discovery booked",
    "Trial proposed",
    "Trial active",
    "Nurture",
    "Won",
    "Lost",
  ],
  language: {
    company: "company",
    companies: "companies",
    contact: "contact",
    contacts: "contacts",
    opportunity: "opportunity",
    opportunities: "opportunities",
    offer: "product",
    offers: "products",
    handoff: "customer handoff",
  },
};
