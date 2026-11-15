/*
 * Route-fallback budget gate (CASE-29), kept free of browser code so its
 * decisions can be self-tested without Chromium.
 *
 * `edge-route-fallback` is advisory in the self-check: a safe orthogonal
 * detour is not a defect by itself. But a gate that ignores it entirely lets a
 * regression turn every wire into a fallback. Each model therefore carries a
 * recorded budget per wire style; the count may not grow and a model needs a
 * recorded budget. A fallback that also crosses a node, package, or boundary
 * is a defect: any such crossing fails unless it is a known defect recorded
 * under `crossings` (a ceiling that may only be lowered, tracked by an open
 * TODO case), and a recorded crossing may not grow either.
 */

export const MODES = ["curved", "orthogonal", "direct"];

/**
 * @param {Record<string, {counts: Record<string, number>, withCrossing: {mode: string, detail: string}[]}>} measured
 * @param {Record<string, Record<string, number>>} budgets
 */
export function compareBudgets(measured, budgets) {
  const failures = [], notes = [];
  for (const [model, result] of Object.entries(measured)) {
    const budget = budgets[model];
    if (!budget) { failures.push(`${model}: no recorded fallback budget (run with --write-budgets after review)`); continue; }
    for (const mode of MODES) {
      const count = result.counts[mode] ?? 0, allowed = budget[mode];
      if (allowed === undefined) failures.push(`${model}/${mode}: no recorded fallback budget`);
      else if (count > allowed) failures.push(`${model}/${mode}: ${count} route fallback(s), budget ${allowed}`);
      else if (count < allowed) notes.push(`${model}/${mode}: ${count} fallback(s) is below its budget of ${allowed}; tighten the budget`);
    }
    const crossings = {};
    for (const entry of result.withCrossing || []) (crossings[entry.mode] ||= []).push(entry.detail);
    for (const mode of MODES) {
      const found = (crossings[mode] || []).length, allowed = budget.crossings?.[mode] ?? 0;
      if (found > allowed) failures.push(`${model}/${mode}: ${found} fallback route(s) also cross something (recorded ${allowed}); first: ${crossings[mode][0]}`);
      else if (found < allowed) notes.push(`${model}/${mode}: ${found} crossing fallback(s) is below its recorded ${allowed}; tighten the budget`);
    }
  }
  for (const model of Object.keys(budgets)) if (!(model in measured)) failures.push(`${model}: budget recorded for a model that was not measured`);
  return { failures, notes };
}

/** Throws unless the gate rejects each injected regression and accepts the baseline. */
export function selfTest() {
  const budgets = { m: { curved: 1, orthogonal: 0, direct: 2 } };
  const clean = { m: { counts: { curved: 1, orthogonal: 0, direct: 2 }, withCrossing: [] } };
  const crossing = { m: { ...clean.m, withCrossing: [{ mode: "direct", detail: "edge crosses node x" }] } };
  const expect = (label, outcome, wantFailure) => {
    if (Boolean(outcome.failures.length) !== wantFailure) throw new Error(`route-fallback gate self-test failed: ${label} -> ${JSON.stringify(outcome)}`);
  };
  expect("baseline passes", compareBudgets(clean, budgets), false);
  expect("every wire falling back fails", compareBudgets({ m: { counts: { curved: 24, orthogonal: 24, direct: 24 }, withCrossing: [] } }, budgets), true);
  expect("one extra fallback fails", compareBudgets({ m: { counts: { curved: 2, orthogonal: 0, direct: 2 }, withCrossing: [] } }, budgets), true);
  expect("a new model without a budget fails", compareBudgets({ ...clean, other: clean.m }, budgets), true);
  expect("a fallback that crosses fails", compareBudgets(crossing, budgets), true);
  expect("a recorded crossing is tolerated", compareBudgets(crossing, { m: { ...budgets.m, crossings: { direct: 1 } } }), false);
  expect("a recorded crossing may not grow", compareBudgets({ m: { ...clean.m, withCrossing: [...crossing.m.withCrossing, { mode: "direct", detail: "second" }] } }, { m: { ...budgets.m, crossings: { direct: 1 } } }), true);
  expect("an improvement is only a note", compareBudgets({ m: { counts: { curved: 0, orthogonal: 0, direct: 0 }, withCrossing: [] } }, budgets), false);
}
