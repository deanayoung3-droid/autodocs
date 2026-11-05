"use client";

import { useState } from "react";
import { SECTION_ICONS, SectionIcon } from "@/components/section-icon";
import { saveCollectionAction } from "../actions";
import { ActionForm, FormMessage, SubmitButton, useActionForm } from "../ui";

/** A grid of line icons; a section saved with an emoji keeps it until another icon is picked. */
function IconPicker({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial || "book");
  const custom = value && !SECTION_ICONS.includes(value);
  return (
    <fieldset>
      <legend className="label">Icon</legend>
      <input type="hidden" name="icon" value={value} />
      <div className="flex flex-wrap gap-1.5">
        {custom && (
          <button type="button" aria-pressed className="flex size-9 items-center justify-center rounded-lg border border-accent bg-accent-soft text-[18px]">
            {value}
          </button>
        )}
        {SECTION_ICONS.map((name) => (
          <button
            key={name}
            type="button"
            title={name}
            aria-label={name}
            aria-pressed={value === name}
            onClick={() => setValue(name)}
            className={`flex size-9 items-center justify-center rounded-lg border transition-colors ${
              value === name ? "border-accent bg-accent-soft text-accent-strong" : "border-line text-graphite hover:border-line-strong hover:bg-sunken"
            }`}
          >
            <SectionIcon value={name} size={17} />
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export type SectionOption = { id: number; name: string; depth: number };
export type SectionValues = { id: number; name: string; description: string; icon: string; parent_id: number | null; restricted: boolean };

/** Create or edit a section: name, icon, description, where it sits, and who can read it. */
export function SectionForm({
  options,
  section,
  defaultParent,
}: {
  options: SectionOption[];
  section?: SectionValues;
  defaultParent?: number | null;
}) {
  const form = useActionForm(saveCollectionAction);
  const p = section?.id ?? "new";
  return (
    <ActionForm form={form} className="grid gap-4 sm:grid-cols-2">
      {section && <input type="hidden" name="id" value={section.id} />}
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`sc-name-${p}`}>
          Name
        </label>
        <input id={`sc-name-${p}`} name="name" defaultValue={section?.name} required className="field" autoFocus={!section} />
      </div>
      <div className="sm:col-span-2">
        <IconPicker initial={section?.icon ?? ""} />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`sc-desc-${p}`}>
          Description
        </label>
        <input id={`sc-desc-${p}`} name="description" defaultValue={section?.description} placeholder="Shown on the section's card in the help center" className="field" />
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor={`sc-parent-${p}`}>
          Inside
        </label>
        <select id={`sc-parent-${p}`} name="parent" defaultValue={section?.parent_id ?? defaultParent ?? ""} className="field">
          <option value="">Home (top level)</option>
          {options.map((n) => (
            <option key={n.id} value={n.id}>
              {"  ".repeat(n.depth)}
              {n.name}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-start gap-2.5 text-[13px] sm:col-span-2">
        <input type="checkbox" name="restricted" defaultChecked={Boolean(section?.restricted)} className="mt-0.5 size-4 accent-[var(--accent)]" />
        <span>
          Restricted
          <span className="block text-muted">Only signed-in readers can see it, including everything inside.</span>
        </span>
      </label>
      <div className="sm:col-span-2">
        <FormMessage state={form.state} />
      </div>
      <div className="sm:col-span-2">
        <SubmitButton pendingLabel="Saving…">{section ? "Save section" : "Create section"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
