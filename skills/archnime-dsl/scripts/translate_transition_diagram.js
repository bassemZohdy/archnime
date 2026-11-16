/* Browser-side DSL → renderer MODEL translator.
 *
 * The mapping intentionally follows translate_transition_diagram.py. Keep the
 * semantic YAML in the DSL and put renderer-only shape/layout details in the
 * generated MODEL. This file is a plain global for zero-build browser use.
 */
(function (global) {
  "use strict";

  const Validator = () => global.TransitionDiagramValidator;
  const DEFAULT_CANVAS = { w: 1600, h: 900, minWidth: 960 };
  const SHAPE_BY_TYPE = { actor: "actor", database: "db", cache: "db", queue: "queue", topic: "queue", package: "package" };
  const copy = value => value === undefined ? value : JSON.parse(JSON.stringify(value));

  function rendererShape(type) { return SHAPE_BY_TYPE[type] || type; }

  function copyMeta(meta) {
    const result = {};
    Object.entries(meta || {}).forEach(([key, value]) => { if (key !== "flow") result[key] = copy(value); });
    const flow = meta && meta.flow || {};
    if (Object.keys(flow).length) {
      const presentation = {};
      if (Array.isArray(flow.secondary)) presentation.secondaryTypes = copy(flow.secondary);
      ["mode", "secondaryRoute"].forEach(key => { if (key in flow) presentation[key] = copy(flow[key]); });
      if (Object.keys(presentation).length) result.flowPresentation = presentation;
      const config = {};
      ["intro", "render", "autoAdvanceMs", "loop"].forEach(key => { if (key in flow) config[key] = copy(flow[key]); });
      if (Object.keys(config).length) result.flow = config;
    }
    return result;
  }

  function copyCatalog(catalog) {
    const result = {};
    Object.entries(catalog || {}).forEach(([id, source]) => {
      const node = { label: source.label, type: source.type, shape: rendererShape(source.type), kind: source.kind || "existing" };
      ["detail", "level", "contains", "navigateTo", "ops", "source"].forEach(key => { if (key in source) node[key] = copy(source[key]); });
      if (Array.isArray(source.size)) { node.w = source.size[0]; node.h = source.size[1]; }
      result[id] = node;
    });
    return result;
  }

  function copyPackages(packages) {
    const result = {};
    Object.entries(packages || {}).forEach(([id, source]) => {
      const pkg = { label: source.label, children: copy(source.children) };
      ["level", "detail", "kind", "ops"].forEach(key => { if (key in source) pkg[key] = copy(source[key]); });
      result[id] = pkg;
    });
    return result;
  }

  function copyNode(entry) {
    if (typeof entry === "string") return entry;
    const result = { id: entry.id };
    ["label", "detail", "kind", "navigateTo", "contains", "ops", "source"].forEach(key => { if (key in entry) result[key] = copy(entry[key]); });
    if (Array.isArray(entry.size)) { result.w = entry.size[0]; result.h = entry.size[1]; }
    return result;
  }

  function copyStage(source, defaultId) {
    const stage = {
      id: source.id || defaultId || "only",
      title: source.title || source.id || defaultId || "Stage",
      nodes: (source.nodes || []).map(copyNode),
      wires: Validator().normalizeWires(source.wires || []),
    };
    ["summary", "callout", "docs", "adr", "changes", "boundaries", "changed", "disclosure", "expandedPackages", "layout", "navigateTo", "comparison"].forEach(key => {
      if (key in source) stage[key] = copy(source[key]);
    });
    return stage;
  }

  function wireKey(value) {
    const wire = typeof value === "string" ? Validator().parseWireShorthand(value) : value;
    return `${wire.from}>${wire.to}>${wire.type || "data"}`;
  }

  function materializeSteps(source) {
    let current = copy(source.base), states = [copy(current)];
    (source.sequence || []).forEach(step => {
      const next = copy(current), add = step.add || {}, remove = step.remove || {}, removedNodes = new Set(remove.nodes || []), removedWires = new Set((remove.wires || []).map(wireKey));
      next.nodes = (next.nodes || []).filter(node => !removedNodes.has(typeof node === "string" ? node : node.id)).concat(copy(add.nodes || []));
      next.wires = Validator().normalizeWires(next.wires || []).filter(wire => !removedWires.has(wireKey(wire)) && !removedNodes.has(wire.from) && !removedNodes.has(wire.to)).concat(Validator().normalizeWires(copy(add.wires || [])));
      Object.entries(step.set || {}).forEach(([id, override]) => {
        const nodeIndex = next.nodes.findIndex(node => (typeof node === "string" ? node : node.id) === id);
        if (nodeIndex >= 0) next.nodes[nodeIndex] = { ...(typeof next.nodes[nodeIndex] === "string" ? { id } : copy(next.nodes[nodeIndex])), ...copy(override || {}) };
      });
      ["id", "title", "summary", "changes", "callout", "docs", "adr", "boundaries", "changed", "disclosure", "expandedPackages", "layout", "navigateTo"].forEach(key => { if (key in step) next[key] = copy(step[key]); });
      states.push(copy(next)); current = next;
    });
    return states;
  }

  function copySteps(source) { return materializeSteps(source).map(state => copyStage(state)); }

  function copyScenarios(source) {
    const normalized = copy(source), base = normalized.base || {};
    if (!base.id) base.id = "base";
    const stages = [copyStage(base)];
    (normalized.variants || []).forEach(variant => {
      stages.push(copySteps({ base, sequence: [variant] })[1]);
    });
    return stages;
  }

  function copyFlow(source, intro = false) {
    const wires = Validator().normalizeWires(source.wires || []), known = new Map(wires.map(wire => [`${wire.from}>${wire.to}>${wire.type || "data"}`, wire])), reverse = new Map(wires.map(wire => [`${wire.to}>${wire.from}>${wire.type || "data"}`, wire]));
    const normalizeEdge = (text, kind, repeat = undefined) => {
      const edge = Validator().parseWireShorthand(text), wireType = edge.type || "data", target = known.get(`${edge.from}>${edge.to}>${wireType}`) || (kind === "return" ? reverse.get(`${edge.from}>${edge.to}>${wireType}`) : null);
      const result = { from: edge.from, to: edge.to, kind, wireType, wireFrom: target ? target.from : null, wireTo: target ? target.to : null };
      if (repeat !== undefined) result.repeat = copy(repeat);
      return result;
    };
    const normalizeNode = (step, inheritedKind) => {
      const kind = step.kind || inheritedKind, result = { kind, edges: [] };
      ["title", "note", "label", "repeat", "navigateTo", "source"].forEach(key => { if (key in step) result[key] = copy(step[key]); });
      if (typeof step.edge === "string") result.edges = [normalizeEdge(step.edge, kind, step.repeat)];
      else if (Array.isArray(step.group)) { result.group = true; result.edges = step.group.map(edge => normalizeEdge(edge, kind, step.repeat)); }
      else if (Array.isArray(step.parallel)) {
        result.parallel = true;
        result.steps = step.parallel.filter(child => child && typeof child === "object").map(child => normalizeNode(child, kind));
        result.edges = result.steps.flatMap(child => child.edges || []);
      }
      return result;
    };
    const copyStep = (step, index) => ({ ...normalizeNode(step, step.kind || "call"), id: `step-${index + 1}` });
    const steps = (source.steps || []).map(copyStep);
    if (intro) {
      const titles = steps.map((step, index) => step.title || step.label || `Step ${index + 1}`);
      steps.unshift({ id: "flow-intro", title: "Flow overview", kind: "intro", edges: [], note: `Steps: ${titles.join(" → ")}` });
    }
    const flow = { id: source.id || "flow", title: source.title, nodes: (source.nodes || []).map(copyNode), wires: copy(wires), steps };
    const stage = { id: flow.id, title: flow.title, nodes: copy(flow.nodes), wires: copy(flow.wires) };
    ["summary", "callout", "docs", "adr", "boundaries", "expandedPackages", "layout"].forEach(key => { if (key in source) { flow[key] = copy(source[key]); stage[key] = copy(source[key]); } });
    return { flow, stage };
  }

  function deploymentInstanceId(component, target, index) { return `${component}-${target}-${index + 1}`; }

  function copyDeploymentView(doc, view) {
    const catalog = copyCatalog(doc.catalog), infrastructure = copy((view.deployment || {}).infrastructure || {}), parentOf = {};
    Object.entries(infrastructure).forEach(([id, item]) => (item.children || []).forEach(child => { if (infrastructure[child] && !parentOf[child]) parentOf[child] = id; }));
    const placements = [], componentInstances = {}, usedInstanceIds = new Set([...Object.keys(catalog), ...Object.keys(doc.packages || {})]), nextInstanceIndex = new Map();
    const allocateInstanceId = (component, target) => {
      const pair = `${component}>${target}`;
      let index = nextInstanceIndex.get(pair) || 0, candidate;
      do { candidate = deploymentInstanceId(component, target, index++); } while (usedInstanceIds.has(candidate));
      nextInstanceIndex.set(pair, index); usedInstanceIds.add(candidate); return candidate;
    };
    (view.deployment.placements || []).forEach(placement => {
      const replicas = Number.isInteger(placement.replicas) ? placement.replicas : 1, instanceIds = Array.from({ length: replicas }, () => allocateInstanceId(placement.component, placement.target));
      componentInstances[placement.component] = (componentInstances[placement.component] || []).concat(instanceIds);
      placements.push({ ...copy(placement), replicas, instanceIds });
      const source = catalog[placement.component] || { label: placement.component, type: "service", shape: "service" };
      const override = (view.nodes || []).find(node => node && typeof node === "object" && node.id === placement.component) || {};
      instanceIds.forEach((instanceId, index) => {
        const instance = { ...copy(source), label: `${source.label || placement.component} · ${placement.label || (replicas > 1 ? `replica ${index + 1}` : placement.target)}`, deploymentComponent: placement.component, deploymentTarget: placement.target };
        ["label", "detail", "kind", "navigateTo", "ops"].forEach(key => { if (key in override) instance[key] = copy(override[key]); });
        if (Array.isArray(override.size)) { instance.w = override.size[0]; instance.h = override.size[1]; }
        catalog[instanceId] = instance;
      });
    });
    const packages = copyPackages(doc.packages), packageIds = Object.fromEntries(Object.keys(infrastructure).map(id => [id, `deployment_${id}`]));
    Object.entries(infrastructure).forEach(([id, item]) => { packages[packageIds[id]] = { label: item.label || id, detail: item.detail, kind: "existing", children: (item.children || []).filter(child => packageIds[child]).map(child => packageIds[child]).concat(...placements.filter(placement => placement.target === id).map(placement => placement.instanceIds)), deploymentKind: item.kind, ...(hasOwn(item, "ops") ? { ops: item.ops } : {}) }; });
    const roots = Object.keys(infrastructure).filter(id => !parentOf[id]), nodes = Object.values(componentInstances).flat(), wires = [];
    Validator().normalizeWires(view.wires || []).forEach(wire => {
      const sources = componentInstances[wire.from] || [], targets = componentInstances[wire.to] || [];
      if (!sources.length || !targets.length) return;
      // A logical relationship represents connectivity, not every possible
      // replica pair. Keep one deterministic representative route so a
      // 3x3 placement does not become nine visually identical wires.
      wires.push({ ...copy(wire), from: sources[0], to: targets[0], logicalFrom: wire.from, logicalTo: wire.to, replicaFanout: "representative" });
    });
    const stage = { id: view.id || "deployment", title: view.title, nodes, wires, expandedPackages: Object.values(packageIds), layout: view.layout || "deployment" };
    ["summary", "callout", "docs", "adr", "changed", "disclosure", "layout"].forEach(key => { if (key in view) stage[key] = copy(view[key]); });
    const packageSource = doc.packages || {};
    const leafComponents = (id, trail = new Set()) => {
      if (trail.has(id)) return [];
      const pkg = packageSource[id];
      if (!pkg || typeof pkg !== "object") return componentInstances[id] ? [id] : [];
      const nextTrail = new Set(trail); nextTrail.add(id);
      return [...new Set((pkg.children || []).flatMap(child => leafComponents(child, nextTrail)))];
    };
    stage.boundaries = (view.boundaries || []).map(boundary => {
      const contains = [];
      (boundary.contains || []).flatMap(id => leafComponents(id)).forEach(component => (componentInstances[component] || []).forEach(instanceId => { if (!contains.includes(instanceId)) contains.push(instanceId); }));
      return { ...copy(boundary), contains };
    });
    const normalizedInfrastructure = Object.entries(infrastructure).map(([id, item]) => ({ id, label: item.label || id, kind: item.kind, parent: parentOf[id] || null, children: copy(item.children || []), ...(hasOwn(item, "detail") ? { detail: copy(item.detail) } : {}), ...(hasOwn(item, "ops") ? { ops: item.ops } : {}) }));
    return { meta: copyMeta(doc.meta), canvas: { ...DEFAULT_CANVAS, ...(copy(doc.canvas) || {}) }, catalog, packages, stages: [stage], deployment: { infrastructure: normalizedInfrastructure, roots, placements } };
  }

  function translateView(doc, view) {
    if (view.mode === "deployment") return { ...copyDeploymentView(doc, view), viewId: view.id, viewTitle: view.title, viewMode: view.mode, ...(hasOwn(view, "comparison") ? { comparison: copy(view.comparison) } : {}) };
    const legacy = { ...copy(doc), dsl: "transition-diagram/1.0" };
    delete legacy.views;
    const payload = copy(view); delete payload.mode; delete payload.comparison;
    legacy[view.mode] = payload;
    if (view.mode === "scenarios") legacy.meta = { ...legacy.meta, composition: "scenarios" };
    const result = translateValidated(legacy);
    return { ...result, viewId: view.id, viewTitle: view.title, viewMode: view.mode, ...(hasOwn(view, "comparison") ? { comparison: copy(view.comparison) } : {}) };
  }

  function compactView(result, shared) {
    const compact = {};
    Object.entries(result).forEach(([key, value]) => { if (!["meta", "canvas", "catalog", "packages"].includes(key)) compact[key] = copy(value); });
    if (JSON.stringify(result.meta) !== JSON.stringify(shared.meta)) compact.meta = copy(result.meta);
    if (JSON.stringify(result.canvas) !== JSON.stringify(shared.canvas)) compact.canvas = copy(result.canvas);
    const delta = (full, base) => Object.fromEntries(Object.entries(full || {}).filter(([key, value]) => !(key in base) || JSON.stringify(base[key]) !== JSON.stringify(value)).map(([key, value]) => [key, copy(value)]));
    const catalog = delta(result.catalog, shared.catalog), packages = delta(result.packages, shared.packages);
    if (Object.keys(catalog).length) compact.catalog = catalog;
    if (Object.keys(packages).length) compact.packages = packages;
    return compact;
  }

  // The public entry point validates once. A v2 view is translated through its
  // legacy single-mode shape, which carries the view's own id and title and so
  // would fail a second validation (the Python translator likewise validates
  // only at the CLI boundary), hence translateValidated for the internal path.
  function translateDocument(doc) {
    const findings = Validator().validateDocument(doc);
    if (findings.length) {
      const error = new Error(`translation blocked by ${findings.length} validation finding(s)`);
      error.findings = findings;
      throw error;
    }
    return translateValidated(doc);
  }

  function translateValidated(doc) {
    if (doc.dsl === "transition-diagram/2.0" && hasOwn(doc, "views")) {
      const shared = { meta: copyMeta(doc.meta), canvas: { ...DEFAULT_CANVAS, ...(copy(doc.canvas) || {}) }, catalog: copyCatalog(doc.catalog), packages: copyPackages(doc.packages) };
      const views = doc.views.map(view => compactView(translateView(doc, view), shared));
      if (!views.length) throw new Error("views must contain at least one view");
      return { meta: copy(shared.meta), canvas: copy(shared.canvas), shared: { catalog: copy(shared.catalog), packages: copy(shared.packages) }, views };
    }
    let stages, flow = null;
    if (hasOwn(doc, "flow")) { const copied = copyFlow(doc.flow, Boolean(doc.meta?.flow?.intro)); flow = copied.flow; stages = [copied.stage]; }
    else if (hasOwn(doc, "steps")) stages = copySteps(doc.steps);
    else if (hasOwn(doc, "scenarios")) stages = copyScenarios(doc.scenarios);
    else stages = hasOwn(doc, "system") ? [copyStage(doc.system, "only")] : (doc.transition.states || []).map(state => copyStage(state));
    const canvas = { ...DEFAULT_CANVAS, ...(copy(doc.canvas) || {}) }, result = { meta: copyMeta(doc.meta), canvas, catalog: copyCatalog(doc.catalog), packages: copyPackages(doc.packages), stages };
    if (flow) result.flow = flow;
    return result;
  }

  function hasOwn(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }

  function mermaidIdentifier(value, used) {
    let candidate = String(value).replace(/[^A-Za-z0-9_]/g, "_");
    if (!candidate || /^\d/.test(candidate)) candidate = `p_${candidate}`;
    const base = candidate; let suffix = 2;
    while (used.has(candidate)) candidate = `${base}_${suffix++}`;
    used.add(candidate); return candidate;
  }

  function sequenceMermaid(model) {
    const flow = model && model.flow;
    if (!flow) throw new Error("--sequence requires a flow: document");
    const catalog = model.catalog || {}, participantIds = (flow.nodes || []).map(entry => typeof entry === "string" ? entry : entry && entry.id).filter(Boolean), used = new Set(), aliases = Object.fromEntries(participantIds.map(id => [id, mermaidIdentifier(id, used)])), lines = ["sequenceDiagram"];
    participantIds.forEach(id => lines.push(`    participant ${aliases[id]} as ${String(catalog[id]?.label || id).replace(/\n/g, " ")}`));
    const wires = Object.fromEntries((flow.wires || []).map(wire => [`${wire.from}>${wire.to}>${wire.type || "data"}`, wire]));
    const edgeEntries = step => [ ...(step?.edge && typeof step.edge === "object" ? [step.edge] : []), ...(Array.isArray(step?.edges) ? step.edges : []) ];
    const participants = step => { const result = []; edgeEntries(step).forEach(edge => [edge.from, edge.to].forEach(id => { if (id && !result.includes(id)) result.push(id); })); (Array.isArray(step?.parallel) ? step.parallel : []).forEach(child => participants(child).forEach(id => { if (!result.includes(id)) result.push(id); })); return result; };
    const wireLabel = (edge, step) => { const type = edge.wireType || edge.type || "data", wire = wires[`${edge.from}>${edge.to}>${type}`] || (edge.kind === "return" ? wires[`${edge.to}>${edge.from}>${type}`] : null); return String(step.label || wire?.label || `${edge.from} → ${edge.to}`).replace(/\n/g, " "); };
    const emitEdge = (edge, step, indent) => { const source = edge.from, target = edge.to; if (!aliases[source] || !aliases[target]) return; const kind = edge.kind || step.kind || "call", arrow = kind === "async" || kind === "return" ? "-->>" : "->>"; lines.push(`${indent}${aliases[source]}${arrow}${aliases[target]}: ${wireLabel(edge, step)}`); };
    const emitStep = (step, indent = "    ", nested = false) => {
      const kind = step.kind || "call"; if (kind === "intro") return;
      const title = String(step.title || step.label || "parallel work").replace(/\n/g, " "), named = participants(step).filter(id => aliases[id]).map(id => aliases[id]), people = (named.length < 2 ? named : [named[0], named[named.length - 1]]).join(",");
      if (!nested && step.note && people) lines.push(`${indent}Note over ${people}: ${String(step.note).replace(/\n/g, " ")}`);
      if (step.parallel === true) {
        lines.push(`${indent}par ${title}`);
        if (Array.isArray(step.steps) && step.steps.length) step.steps.forEach((child, index) => { if (index) lines.push(`${indent}and ${String(child.title || child.label || "parallel branch").replace(/\n/g, " ")}`); emitStep(child, `${indent}    `, true); });
        else edgeEntries(step).forEach((edge, index) => { if (index) lines.push(`${indent}and parallel branch`); emitStep({ kind: edge.kind || "call", edges: [edge], repeat: edge.repeat || step.repeat, label: step.label }, `${indent}    `, true); });
        lines.push(`${indent}end`); return;
      }
      if (Array.isArray(step.parallel)) { lines.push(`${indent}par ${title}`); step.parallel.forEach((child, index) => { if (index) lines.push(`${indent}and ${String(child.title || child.label || "parallel branch").replace(/\n/g, " ")}`); emitStep(child, `${indent}    `, true); }); lines.push(`${indent}end`); return; }
      const edges = edgeEntries(step); if (kind === "loop") { lines.push(`${indent}loop ${String(step.repeat || "repeat").replace(/\n/g, " ")}`); edges.forEach(edge => emitEdge(edge, step, `${indent}    `)); lines.push(`${indent}end`); return; } edges.forEach(edge => emitEdge(edge, step, indent));
    };
    (flow.steps || []).forEach(step => emitStep(step)); return `${lines.join("\n")}\n`;
  }

  global.TransitionDiagramTranslator = { translateDocument, sequenceMermaid, DEFAULT_CANVAS, SHAPE_BY_TYPE };
})(typeof window !== "undefined" ? window : globalThis);
