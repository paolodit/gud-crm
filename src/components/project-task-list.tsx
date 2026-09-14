"use client";

import { useId, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, Circle, GripVertical, Plus, X } from "lucide-react";
import type { ProjectTask } from "@/lib/domain/delivery";

export function ProjectTaskList({ tasks, disabled, onChange }: { tasks: ProjectTask[]; disabled: boolean; onChange: (tasks: ProjectTask[]) => void }) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, scrollBehavior: "auto" }));
  function add() {
    if (!draft.trim() || tasks.length >= 200 || disabled) return;
    onChange([...tasks, { id: crypto.randomUUID(), text: draft.trim(), completed: false }]); setDraft(""); addInput.current?.focus();
  }
  return <div className="project-tasks form-span-2" ref={container}><div className="project-tasks-heading"><strong>Tasks</strong><small>{tasks.filter((task) => task.completed).length}/{tasks.length} done</small></div>
    <DndContext id={id} sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => { if (over && active.id !== over.id) onChange(arrayMove(tasks, tasks.findIndex((task) => task.id === active.id), tasks.findIndex((task) => task.id === over.id))); }}><SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
      <div className="project-task-rows">{tasks.map((task, index) => <TaskRow key={task.id} task={task} disabled={disabled} onChange={(next) => onChange(tasks.map((item) => item.id === task.id ? next : item))} onRemove={() => onChange(tasks.filter((item) => item.id !== task.id))} onEnter={() => { const inputs = container.current?.querySelectorAll<HTMLInputElement>(".project-task-text"); (inputs?.[index + 1] ?? addInput.current)?.focus(); }} />)}</div>
    </SortableContext></DndContext>
    <div className="project-task-add"><Plus size={15} /><input ref={addInput} name="projectTaskDraft" aria-label="Add a project task" placeholder="Add a task and press Enter" maxLength={500} value={draft} disabled={disabled || tasks.length >= 200} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); add(); } }} /><button type="button" className="icon-button" aria-label="Add task" disabled={disabled || !draft.trim() || tasks.length >= 200} onClick={add}><Plus size={15} /></button></div>
    <small className="muted">Enter adds the next task · Drag to reorder · Saved with the project</small>
  </div>;
}

function TaskRow({ task, disabled, onChange, onRemove, onEnter }: { task: ProjectTask; disabled: boolean; onChange: (task: ProjectTask) => void; onRemove: () => void; onEnter: () => void }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: task.id, disabled });
  return <div ref={setNodeRef} className="project-task-row" data-task-id={task.id} data-completed={task.completed} data-dragging={isDragging} style={{ transform: CSS.Transform.toString(transform), transition }}><button type="button" className="project-task-check" aria-label={`${task.completed ? "Reopen" : "Complete"} task ${task.text}`} aria-pressed={task.completed} disabled={disabled} onClick={() => onChange({ ...task, completed: !task.completed })}>{task.completed ? <Check size={16} /> : <Circle size={16} />}</button><input className="project-task-text" aria-label="Task text" value={task.text} required maxLength={500} disabled={disabled} onChange={(event) => onChange({ ...task, text: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); onEnter(); } }} /><button type="button" className="project-task-grip" aria-label={`Reorder task ${task.text}`} disabled={disabled} {...attributes} {...listeners}><GripVertical size={15} /></button><button type="button" className="project-task-remove" aria-label={`Remove task ${task.text}`} disabled={disabled} onClick={onRemove}><X size={15} /></button></div>;
}
