import type { OfferSummary } from "@/lib/domain/types";

export type EditionKey = "focused" | "service";

export type EditionDefinition = {
  key: EditionKey;
  name: string;
  shortName: string;
  audience: string;
  description: string;
  pipelineName: string;
  defaultOffer: OfferSummary;
  stageNames: string[];
  language: {
    company: string;
    companies: string;
    contact: string;
    contacts: string;
    opportunity: string;
    opportunities: string;
    offer: string;
    offers: string;
    handoff: string;
  };
};
