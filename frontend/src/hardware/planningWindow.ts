/**
 * The optional planning window of a hardware project, as the dialogs edit it.
 */

export interface PlanningWindowDraft {
  start: string
  end: string
}

export const EMPTY_WINDOW: PlanningWindowDraft = { start: '', end: '' }

export function windowFromProject(project: {
  start_year: number | null
  end_year: number | null
}): PlanningWindowDraft {
  return {
    start: project.start_year === null ? '' : String(project.start_year),
    end: project.end_year === null ? '' : String(project.end_year),
  }
}

export function yearOrNull(raw: string): number | null {
  const value = Number(raw)
  return raw.trim() !== '' && Number.isInteger(value) ? value : null
}

/** The two window fields of `HwProjectInput`, ready to send. */
export function windowPayload(draft: PlanningWindowDraft) {
  return { start_year: yearOrNull(draft.start), end_year: yearOrNull(draft.end) }
}
