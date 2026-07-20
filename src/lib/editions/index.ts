import { focusedEdition } from "@/lib/editions/focused";
import { serviceEdition } from "@/lib/editions/service";
import type { EditionDefinition, EditionKey } from "@/lib/editions/types";

export type { EditionDefinition, EditionKey } from "@/lib/editions/types";

export const editions = [focusedEdition, serviceEdition] as const;

export function isEditionKey(value: unknown): value is EditionKey {
  return value === "focused" || value === "service";
}

export function getEdition(value: unknown): EditionDefinition {
  return editions.find((edition) => edition.key === value) ?? focusedEdition;
}

export function normaliseEditionKey(value: unknown): EditionKey {
  return value === "service" ? "service" : "focused";
}
