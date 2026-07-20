import { z } from "zod";

export const aiCoachModeSchema = z.enum(["coach", "draft", "creative", "recovery"]);
export const aiFeedbackRatingSchema = z.enum(["useful", "not_useful", "already_tried"]);

export const aiCoachOutputSchema = z.object({
  summary: z.string().trim().min(1).max(1_200),
  nextActions: z.array(z.object({
    title: z.string().trim().min(1).max(180),
    reason: z.string().trim().min(1).max(500),
    timing: z.string().trim().min(1).max(100),
    confidence: z.enum(["low", "medium", "high"]),
  })).max(3),
  drafts: z.array(z.object({
    channel: z.enum(["linkedin", "email", "call", "letter"]),
    text: z.string().trim().min(1).max(2_500),
  })).max(4),
  creativeIdeas: z.array(z.object({
    level: z.enum(["sensible", "distinctive", "bold"]),
    idea: z.string().trim().min(1).max(700),
    reason: z.string().trim().min(1).max(500),
    costBand: z.string().trim().min(1).max(80),
  })).max(3),
  warnings: z.array(z.string().trim().min(1).max(400)).max(6),
});

export type AICoachOutputValue = z.infer<typeof aiCoachOutputSchema>;
