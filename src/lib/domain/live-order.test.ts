import { describe, expect, it } from "vitest";
import { deliveryDetails, deliveryPatchSchema, liveProjectRecords, projectTasksSchema, type LiveProject } from "./delivery";
import { moveLiveProject } from "./live-order";
import { demoBoardForEdition } from "@/lib/demo-data";

const project = (id: string, source: LiveProject["source"], position: number, stage = "kickoff"): LiveProject => ({ id, source, title: id, companyName: id, ownerId: null, offerId: null, delivery: deliveryDetails({ position, stage, notes: "Keep me", tasks: [{ id: "00000000-0000-4000-8000-000000000009", text: "Keep task", completed: true }] }) });
describe("live project ordering", () => {
  const a = project("a", "sales", 1000), b = project("b", "direct", 2000), c = project("c", "direct", 3000), d = project("d", "sales", 1000, "in_progress");
  it("reorders a mixed-source column without changing task contents or sales data", () => {
    const result = moveLiveProject([a, b, c, d], { projectId: "a", toStageId: "kickoff", overProjectId: "c", placement: "after" });
    expect(result.filter((p) => p.delivery.stage === "kickoff").sort((l, r) => l.delivery.position! - r.delivery.position!).map((p) => p.id)).toEqual(["b", "c", "a"]);
    expect(result[0].delivery.tasks).toEqual(a.delivery.tasks);
    expect(result[0].delivery.notes).toBe("Keep me");
    expect(result[3]).toBe(d);
  });
  it("inserts across columns relative to an anchor and preserves hidden records", () => {
    const result = moveLiveProject([a, b, c, d], { projectId: "d", toStageId: "kickoff", overProjectId: "b", placement: "before" });
    expect(result.sort((l, r) => l.delivery.position! - r.delivery.position!).map((p) => p.id)).toEqual(["a", "d", "b", "c"]);
    expect(result.find((p) => p.id === "d")?.source).toBe("sales");
  });
  it("rejects missing/archived projects and changed destination anchors", () => {
    expect(() => moveLiveProject([a], { projectId: "foreign", toStageId: "kickoff", overProjectId: null, placement: "before" })).toThrow("no longer");
    expect(() => moveLiveProject([a, d], { projectId: "a", toStageId: "kickoff", overProjectId: "d", placement: "before" })).toThrow("destination changed");
    expect(() => moveLiveProject([{ ...a, delivery: { ...a.delivery, archivedAt: "2026-09-15T00:00:00Z" } }], { projectId: "a", toStageId: "kickoff", overProjectId: null, placement: "before" })).toThrow("no longer");
  });
  it("loads persisted order across direct and won projects", () => {
    const snapshot = demoBoardForEdition("service");
    snapshot.opportunities[0].stageId = snapshot.stages.find((s) => s.terminalType === "won")!.id;
    snapshot.opportunities[0].delivery = deliveryDetails({ position: 2000 });
    const directId = "00000000-0000-4000-8000-000000000003";
    snapshot.directProjects = [{ ...b, id: directId, delivery: deliveryDetails({ position: 1000 }) }];
    expect(liveProjectRecords(snapshot)[0].id).toBe(directId);
  });
});
describe("project task validation", () => {
  const task = { id: "00000000-0000-4000-8000-000000000001", text: " Check handover ", completed: false };
  it("accepts task changes and preserves existing delivery fields", () => {
    expect(deliveryPatchSchema.parse({ tasks: [task] }).tasks?.[0].text).toBe("Check handover");
    expect(deliveryDetails({ tasks: [task], notes: "Brief", position: 3000 })).toMatchObject({ notes: "Brief", position: 3000, tasks: [{ ...task, text: "Check handover" }] });
    expect(deliveryPatchSchema.safeParse({ tasks: [] }).success).toBe(true);
  });
  it("rejects blank, duplicate, oversized and malformed task lists", () => {
    for (const value of [[{ ...task, text: " " }], [task, task], [{ ...task, id: "invalid" }], [{ ...task, text: "a".repeat(501) }], Array.from({ length: 201 }, () => ({ ...task, id: crypto.randomUUID() }))]) expect(projectTasksSchema.safeParse(value).success).toBe(false);
  });
});
