/**
 * Minimum similarity for a fact-check to be shown without confirmation, as
 * "a similar claim was fact-checked". Calibrated with extension/eval/memory.ts.
 */
export const DISPLAY_THRESHOLD = 0.8;

/**
 * Minimum similarity for a fact-check to be offered to the model as a candidate.
 * Lower than the display threshold because the model then confirms or rejects it.
 */
export const CANDIDATE_THRESHOLD = 0.7;
