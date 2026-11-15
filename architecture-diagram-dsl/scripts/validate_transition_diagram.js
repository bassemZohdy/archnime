/* Browser-side validator for transition-diagram/1.0 and /2.0 documents.
 *
 * This is intentionally a plain global rather than an ES module: translate.html
 * must work from a checked-out folder without a build step. The Python
 * validator remains the canonical CLI; this file mirrors its schema boundary
 * and referential lint rules so browser authors get the same rule names.
 */
(function (global) {
  "use strict";

  const ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
  let NODE_TYPES = ["actor", "service", "gateway", "agent", "database", "cache", "queue", "topic", "external", "security", "package"];
  let WIRE_TYPES = ["data", "security", "control", "compat", "neutral"];
  let KINDS = ["existing", "new", "mixed", "security", "retired"];
  const PERSPECTIVES = ["all", "data", "security", "migration", "devops", "control", "compat", "neutral", "zones"];
  let SCHEMA = null;
  const NODE_OVERRIDE_KEYS = new Set(["id", "label", "detail", "kind", "size", "navigateTo", "ops"]);
  const WIRE_KEYS = new Set(["from", "to", "type", "label", "flow", "layer", "bundle", "offset", "priority", "ops"]);

  const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  // The lint pass trusts only well-formed fragments; the schema pass reports the
  // malformed ones, so a wrong shape here is skipped rather than thrown on.
  const arr = value => Array.isArray(value) ? value : [];
  const obj = value => isObject(value) ? value : {};
  const strs = value => arr(value).filter(item => typeof item === "string");
  const finding = (rule, message, path = "", severity = "error") => ({ rule, message, path, severity });
  const schema = (message, path = "$") => finding("schema", message, path);
  const pathKey = (base, key) => `${base}['${String(key).replaceAll("'", "\\'")}']`;
  const pathIndex = (base, index) => `${base}[${index}]`;
  const idValid = value => typeof value === "string" && ID_RE.test(value);
  const enumValid = (value, values) => typeof value === "string" && values.includes(value);
  const numberValid = value => typeof value === "number" && Number.isFinite(value);
  const positiveNumber = value => numberValid(value) && value > 0;
  function configureSchema(document) {
    SCHEMA = document && typeof document === "object" ? document : null;
    const definitions = SCHEMA?.$defs || {};
    const enumValues = name => Array.isArray(definitions[name]?.enum) ? definitions[name].enum.slice() : null;
    NODE_TYPES = enumValues("nodeType") || NODE_TYPES;
    WIRE_TYPES = enumValues("wireType") || WIRE_TYPES;
    KINDS = enumValues("kind") || KINDS;
    return SCHEMA;
  }
  function schemaNodeForPath(path) {
    if (!SCHEMA || typeof path !== "string") return null;
    const tokens = [], tokenPattern = /\['([^']+)'\]|\[(\d+)\]/g;
    let match;
    while ((match = tokenPattern.exec(path))) tokens.push(match[1] ?? Number(match[2]));
    const resolveRef = node => {
      if (!node || typeof node !== "object" || typeof node.$ref !== "string" || !node.$ref.startsWith("#/$defs/")) return node;
      return SCHEMA.$defs?.[node.$ref.slice("#/$defs/".length)] || node;
    };
    let node = SCHEMA;
    for (const token of tokens) {
      node = resolveRef(node);
      if (typeof token === "number") node = node?.items;
      else if (node?.properties && node.properties[token]) node = node.properties[token];
      else if (node?.additionalProperties && typeof node.additionalProperties === "object") node = node.additionalProperties;
      else return null;
    }
    return resolveRef(node);
  }
  function checkDocumentation(value, path, findings) {
    ["docs", "adr"].forEach(key => { if (has(value, key) && (typeof value[key] !== "string" || !value[key].trim())) findings.push(schema(`${key} must be a non-empty string`, pathKey(path, key))); });
  }

  function checkAdditional(value, allowed, path, findings) {
    if (!isObject(value)) return;
    const schemaNode = schemaNodeForPath(path), schemaAllowed = schemaNode?.properties ? new Set(Object.keys(schemaNode.properties)) : null, effective = schemaAllowed || allowed;
    Object.keys(value).filter(key => !effective.has(key)).forEach(key => findings.push(schema(`must NOT have additional properties: ${key}`, pathKey(path, key))));
    const viewAsState = schemaNode?.required?.includes("mode") && !has(value, "mode") && has(value, "nodes");
    if (schemaNode?.required && !viewAsState) schemaNode.required.filter(key => !has(value, key)).forEach(key => findings.push(schema(`must have required property: ${key}`, pathKey(path, key))));
  }

  function checkSize(value, path, findings) {
    if (!Array.isArray(value) || value.length < 2 || value.length > 2 || !value.every(positiveNumber)) {
      findings.push(schema("must be an array of two positive numbers", path));
    }
  }

  function checkIcons(value, path, findings) {
    if (!isObject(value)) { findings.push(schema("icons must be an object", path)); return; }
    Object.entries(value).forEach(([type, definition]) => {
      const definitionPath = pathKey(path, type);
      if (!idValid(type)) findings.push(schema("icon type keys must be valid ids", definitionPath));
      if (NODE_TYPES.includes(type)) findings.push(schema(`meta.icons cannot replace built-in node type ${type}`, definitionPath));
      if (typeof definition === "string") {
        if (!definition.length || !NODE_TYPES.includes(definition)) findings.push(schema("icon alias must name a built-in node type", definitionPath));
      } else if (isObject(definition)) {
        checkAdditional(definition, new Set(["viewBox", "markup"]), definitionPath, findings);
        if (typeof definition.viewBox !== "string" || !definition.viewBox.length || typeof definition.markup !== "string" || !definition.markup.length) findings.push(schema("custom icon requires non-empty viewBox and markup", definitionPath));
      } else findings.push(schema("icon definition must be a built-in alias or an object with viewBox and markup", definitionPath));
    });
  }

  function checkNodeRef(value, path, findings) {
    if (typeof value === "string") {
      if (!idValid(value)) findings.push(schema("must match the catalog id pattern", path));
      return;
    }
    if (!isObject(value)) {
      findings.push(schema("must be a catalog id or node override", path));
      return;
    }
    checkAdditional(value, NODE_OVERRIDE_KEYS, path, findings);
    if (!has(value, "id") || !idValid(value.id)) findings.push(schema("must have a valid id", path));
    if (has(value, "label") && typeof value.label !== "string") findings.push(schema("label must be a string", pathKey(path, "label")));
    if (has(value, "detail") && typeof value.detail !== "string") findings.push(schema("detail must be a string", pathKey(path, "detail")));
    if (has(value, "kind") && !enumValid(value.kind, KINDS)) findings.push(schema(`kind must be one of ${JSON.stringify(KINDS)}`, pathKey(path, "kind")));
    if (has(value, "size")) checkSize(value.size, pathKey(path, "size"), findings);
    if (has(value, "navigateTo") && !idValid(value.navigateTo)) findings.push(schema("navigateTo must be a valid id", pathKey(path, "navigateTo")));
    if (has(value, "ops") && typeof value.ops !== "boolean") findings.push(schema("ops must be a boolean", pathKey(path, "ops")));
  }

  function checkWire(value, path, findings) {
    if (typeof value === "string") {
      if (!value.trim()) findings.push(schema("must be a non-empty string", path));
      return;
    }
    if (!isObject(value)) {
      findings.push(schema("must be a shorthand string or wire mapping", path));
      return;
    }
    checkAdditional(value, WIRE_KEYS, path, findings);
    if (!idValid(value.from) || !idValid(value.to)) findings.push(schema("wire mappings require valid from and to ids", path));
    if (has(value, "type") && !enumValid(value.type, WIRE_TYPES)) findings.push(schema(`type must be one of ${JSON.stringify(WIRE_TYPES)}`, pathKey(path, "type")));
    if (has(value, "label") && typeof value.label !== "string") findings.push(schema("label must be a string", pathKey(path, "label")));
    if (has(value, "flow") && typeof value.flow !== "boolean") findings.push(schema("flow must be a boolean", pathKey(path, "flow")));
    if (has(value, "layer") && !["primary", "secondary"].includes(value.layer)) findings.push(schema("layer must be primary or secondary", pathKey(path, "layer")));
    if (has(value, "bundle") && typeof value.bundle !== "string") findings.push(schema("bundle must be a string", pathKey(path, "bundle")));
    if (has(value, "offset") && !numberValid(value.offset)) findings.push(schema("offset must be a number", pathKey(path, "offset")));
    if (has(value, "priority") && !numberValid(value.priority)) findings.push(schema("priority must be a number", pathKey(path, "priority")));
    if (has(value, "ops") && typeof value.ops !== "boolean") findings.push(schema("ops must be a boolean", pathKey(path, "ops")));
  }

  function checkBoundary(value, path, findings) {
    const allowed = new Set(["id", "label", "tone", "contains", "ops"]);
    if (!isObject(value)) { findings.push(schema("boundary must be an object", path)); return; }
    checkAdditional(value, allowed, path, findings);
    if (!idValid(value.id)) findings.push(schema("boundary requires a valid id", pathKey(path, "id")));
    if (typeof value.label !== "string" || !value.label.length) findings.push(schema("boundary requires a non-empty label", pathKey(path, "label")));
    if (has(value, "tone") && typeof value.tone !== "string") findings.push(schema("boundary tone must be a string", pathKey(path, "tone")));
    if (has(value, "ops") && typeof value.ops !== "boolean") findings.push(schema("boundary ops must be a boolean", pathKey(path, "ops")));
    if (!Array.isArray(value.contains) || value.contains.length < 1 || !value.contains.every(idValid)) findings.push(schema("boundary contains must be a non-empty id array", pathKey(path, "contains")));
  }

  function checkDisclosure(value, path, findings) {
    const allowed = new Set(["mode", "initialStep", "intervalMs", "layers", "auto"]);
    if (!isObject(value)) { findings.push(schema("disclosure must be an object", path)); return; }
    checkAdditional(value, allowed, path, findings);
    if (value.mode !== "progressive") findings.push(schema("disclosure mode must be progressive", pathKey(path, "mode")));
    if (!Array.isArray(value.layers) || value.layers.length < 1) findings.push(schema("disclosure layers must be a non-empty array", pathKey(path, "layers")));
    else value.layers.forEach((layer, index) => {
      const layerPath = pathIndex(pathKey(path, "layers"), index);
      if (!isObject(layer) || typeof layer.id !== "string" || typeof layer.label !== "string") findings.push(schema("disclosure layer requires id and label", layerPath));
      else checkAdditional(layer, new Set(["id", "label"]), layerPath, findings);
    });
    if (has(value, "initialStep") && (!Number.isInteger(value.initialStep) || value.initialStep < 0)) findings.push(schema("initialStep must be a non-negative integer", pathKey(path, "initialStep")));
    if (has(value, "intervalMs") && !positiveNumber(value.intervalMs)) findings.push(schema("intervalMs must be positive", pathKey(path, "intervalMs")));
    if (has(value, "auto") && typeof value.auto !== "boolean") findings.push(schema("auto must be a boolean", pathKey(path, "auto")));
  }

  function checkComparison(value, path, findings) {
    if (!isObject(value)) { findings.push(schema("comparison must be an object", path)); return; }
    checkAdditional(value, new Set(["criteria", "recommended"]), path, findings);
    const criteriaPath = pathKey(path, "criteria");
    if (!Array.isArray(value.criteria) || value.criteria.length < 1) findings.push(schema("comparison criteria must be a non-empty array", criteriaPath));
    else value.criteria.forEach((criterion, index) => {
      const criterionPath = pathIndex(criteriaPath, index);
      if (!isObject(criterion)) { findings.push(schema("comparison criterion must be an object", criterionPath)); return; }
      checkAdditional(criterion, new Set(["id", "label", "weight"]), criterionPath, findings);
      if (!idValid(criterion.id)) findings.push(schema("comparison criterion id must be a valid id", pathKey(criterionPath, "id")));
      if (typeof criterion.label !== "string" || !criterion.label.length) findings.push(schema("comparison criterion label must be a non-empty string", pathKey(criterionPath, "label")));
      if (has(criterion, "weight") && !positiveNumber(criterion.weight)) findings.push(schema("comparison criterion weight must be positive", pathKey(criterionPath, "weight")));
    });
    if (has(value, "recommended") && !idValid(value.recommended)) findings.push(schema("comparison recommended must be a valid id", pathKey(path, "recommended")));
  }

  function checkComparisonView(value, path, findings) {
    if (!isObject(value)) { findings.push(schema("view comparison must be an object", path)); return; }
    checkAdditional(value, new Set(["tradeoffs"]), path, findings);
    if (!has(value, "tradeoffs")) return;
    const tradeoffsPath = pathKey(path, "tradeoffs");
    if (!isObject(value.tradeoffs)) { findings.push(schema("comparison tradeoffs must be an object", tradeoffsPath)); return; }
    Object.entries(value.tradeoffs).forEach(([criterion, tradeoff]) => {
      const tradeoffPath = pathKey(tradeoffsPath, criterion);
      if (!idValid(criterion)) findings.push(schema("comparison tradeoff keys must be valid ids", tradeoffPath));
      if (!isObject(tradeoff)) { findings.push(schema("comparison tradeoff must be an object", tradeoffPath)); return; }
      checkAdditional(tradeoff, new Set(["rating", "note"]), tradeoffPath, findings);
      if (has(tradeoff, "rating") && (!numberValid(tradeoff.rating) || tradeoff.rating < 0 || tradeoff.rating > 5)) findings.push(schema("comparison rating must be a number from 0 to 5", pathKey(tradeoffPath, "rating")));
      if (has(tradeoff, "note") && typeof tradeoff.note !== "string") findings.push(schema("comparison tradeoff note must be a string", pathKey(tradeoffPath, "note")));
    });
  }

  function checkFlowStep(value, path, findings) {
    const allowed = new Set(["title", "edge", "group", "parallel", "note", "label", "kind", "repeat", "navigateTo"]);
    if (!isObject(value)) { findings.push(schema("flow step must be an object", path)); return; }
    checkAdditional(value, allowed, path, findings);
    const branches = ["edge", "group", "parallel"].filter(key => has(value, key));
    if (branches.length !== 1) findings.push(schema("flow step requires exactly one of edge, group, or parallel", path));
    if (has(value, "edge") && (typeof value.edge !== "string" || !value.edge.trim())) findings.push(schema("flow step edge must be a non-empty string", pathKey(path, "edge")));
    if (has(value, "group") && (!Array.isArray(value.group) || value.group.length < 1 || !value.group.every(item => typeof item === "string" && item.trim()))) findings.push(schema("flow step group must be a non-empty string array", pathKey(path, "group")));
    if (has(value, "parallel")) {
      if (!Array.isArray(value.parallel) || value.parallel.length < 1) findings.push(schema("flow step parallel must be a non-empty array", pathKey(path, "parallel")));
      else value.parallel.forEach((step, index) => checkFlowStep(step, pathIndex(pathKey(path, "parallel"), index), findings));
    }
    if (has(value, "note") && typeof value.note !== "string") findings.push(schema("flow step note must be a string", pathKey(path, "note")));
    if (has(value, "title") && (typeof value.title !== "string" || !value.title.length)) findings.push(schema("flow step title must be a non-empty string", pathKey(path, "title")));
    if (has(value, "label") && typeof value.label !== "string") findings.push(schema("flow step label must be a string", pathKey(path, "label")));
    if (has(value, "kind") && !["call", "return", "async", "loop"].includes(value.kind)) findings.push(schema("flow step kind has an invalid value", pathKey(path, "kind")));
    if (has(value, "repeat") && typeof value.repeat !== "string") findings.push(schema("flow step repeat must be a string", pathKey(path, "repeat")));
    if (has(value, "navigateTo") && !idValid(value.navigateTo)) findings.push(schema("navigateTo must be a valid id", pathKey(path, "navigateTo")));
  }

  function checkFlow(value, path, findings) {
    const allowed = new Set(["id", "title", "summary", "callout", "docs", "adr", "boundaries", "nodes", "wires", "steps", "expandedPackages", "layout"]);
    if (!isObject(value)) { findings.push(schema("flow must be an object", path)); return; }
    checkAdditional(value, allowed, path, findings);
    if (has(value, "id") && !idValid(value.id)) findings.push(schema("flow id must be a valid id", pathKey(path, "id")));
    if (typeof value.title !== "string" || !value.title.length) findings.push(schema("flow title must be a non-empty string", pathKey(path, "title")));
    if (!Array.isArray(value.nodes) || value.nodes.length < 1) findings.push(schema("flow nodes must be a non-empty array", pathKey(path, "nodes")));
    else value.nodes.forEach((node, index) => checkNodeRef(node, pathIndex(pathKey(path, "nodes"), index), findings));
    if (!Array.isArray(value.wires)) findings.push(schema("flow wires must be an array", pathKey(path, "wires")));
    else value.wires.forEach((wire, index) => checkWire(wire, pathIndex(pathKey(path, "wires"), index), findings));
    if (!Array.isArray(value.steps) || value.steps.length < 1) findings.push(schema("flow steps must be a non-empty array", pathKey(path, "steps")));
    else value.steps.forEach((step, index) => checkFlowStep(step, pathIndex(pathKey(path, "steps"), index), findings));
    if (has(value, "summary") && typeof value.summary !== "string") findings.push(schema("flow summary must be a string", pathKey(path, "summary")));
    if (has(value, "callout") && typeof value.callout !== "string") findings.push(schema("flow callout must be a string", pathKey(path, "callout")));
    checkDocumentation(value, path, findings);
    if (has(value, "boundaries")) {
      if (!Array.isArray(value.boundaries)) findings.push(schema("flow boundaries must be an array", pathKey(path, "boundaries")));
      else value.boundaries.forEach((boundary, index) => checkBoundary(boundary, pathIndex(pathKey(path, "boundaries"), index), findings));
    }
    if (has(value, "expandedPackages") && (!Array.isArray(value.expandedPackages) || !value.expandedPackages.every(idValid))) findings.push(schema("expandedPackages must be an array of ids", pathKey(path, "expandedPackages")));
    if (has(value, "layout") && !["dagre", "elk", "force", "manual"].includes(value.layout)) findings.push(schema("flow layout must be dagre, elk, force, or manual", pathKey(path, "layout")));
  }

  function checkState(value, path, findings, isSystem = false) {
    const allowed = new Set(isSystem
      ? ["id", "title", "summary", "callout", "docs", "adr", "boundaries", "nodes", "wires", "disclosure", "expandedPackages", "layout"]
      : ["id", "title", "summary", "changes", "callout", "docs", "adr", "boundaries", "nodes", "wires", "changed", "disclosure", "expandedPackages", "layout", "navigateTo"]);
    if (!isObject(value)) { findings.push(schema("state must be an object", path)); return; }
    checkAdditional(value, allowed, path, findings);
    if (!isSystem && !idValid(value.id)) findings.push(schema("state requires a valid id", pathKey(path, "id")));
    if (typeof value.title !== "string" || !value.title.length) findings.push(schema("state requires a non-empty title", pathKey(path, "title")));
    if (has(value, "navigateTo") && !idValid(value.navigateTo)) findings.push(schema("state navigateTo must be a valid id", pathKey(path, "navigateTo")));
    if (!Array.isArray(value.nodes) || value.nodes.length < 1) findings.push(schema("nodes must be a non-empty array", pathKey(path, "nodes")));
    else value.nodes.forEach((node, index) => checkNodeRef(node, pathIndex(pathKey(path, "nodes"), index), findings));
    if (!Array.isArray(value.wires)) findings.push(schema("wires must be an array", pathKey(path, "wires")));
    else value.wires.forEach((wire, index) => checkWire(wire, pathIndex(pathKey(path, "wires"), index), findings));
    if (has(value, "summary") && typeof value.summary !== "string") findings.push(schema("summary must be a string", pathKey(path, "summary")));
    if (has(value, "callout") && typeof value.callout !== "string") findings.push(schema("callout must be a string", pathKey(path, "callout")));
    checkDocumentation(value, path, findings);
    if (has(value, "changes") && (!Array.isArray(value.changes) || !value.changes.every(item => typeof item === "string"))) findings.push(schema("changes must be an array of strings", pathKey(path, "changes")));
    if (has(value, "boundaries") && (!Array.isArray(value.boundaries))) findings.push(schema("boundaries must be an array", pathKey(path, "boundaries")));
    else (value.boundaries || []).forEach((boundary, index) => checkBoundary(boundary, pathIndex(pathKey(path, "boundaries"), index), findings));
    if (has(value, "changed") && (!Array.isArray(value.changed) || !value.changed.every(idValid))) findings.push(schema("changed must be an array of ids", pathKey(path, "changed")));
    if (has(value, "expandedPackages") && (!Array.isArray(value.expandedPackages) || !value.expandedPackages.every(idValid))) findings.push(schema("expandedPackages must be an array of ids", pathKey(path, "expandedPackages")));
    if (has(value, "layout") && !["dagre", "elk", "force", "manual"].includes(value.layout)) findings.push(schema("layout must be dagre, elk, force, or manual", pathKey(path, "layout")));
    if (has(value, "disclosure")) checkDisclosure(value.disclosure, pathKey(path, "disclosure"), findings);
  }

  function checkStepDelta(value, path, findings, removeOnly = false) {
    if (!isObject(value)) { findings.push(schema("step delta must be an object", path)); return; }
    checkAdditional(value, new Set(["nodes", "wires"]), path, findings);
    if (has(value, "nodes")) {
      if (!Array.isArray(value.nodes) || value.nodes.length < 1) findings.push(schema("step delta nodes must be a non-empty array", pathKey(path, "nodes")));
      else value.nodes.forEach((node, index) => removeOnly ? (idValid(node) || findings.push(schema("step remove nodes must be ids", pathIndex(pathKey(path, "nodes"), index)))) : checkNodeRef(node, pathIndex(pathKey(path, "nodes"), index), findings));
    }
    if (has(value, "wires")) {
      if (!Array.isArray(value.wires) || value.wires.length < 1) findings.push(schema("step delta wires must be a non-empty array", pathKey(path, "wires")));
      else value.wires.forEach((wire, index) => checkWire(wire, pathIndex(pathKey(path, "wires"), index), findings));
    }
  }

  function checkStepSet(value, path, findings) {
    if (!isObject(value)) { findings.push(schema("step set must be an object", path)); return; }
    Object.entries(value).forEach(([id, override]) => {
      const overridePath = pathKey(path, id);
      if (!idValid(id)) findings.push(schema("step set keys must be valid ids", overridePath));
      if (!isObject(override)) { findings.push(schema("step set value must be an object", overridePath)); return; }
      checkAdditional(override, new Set(["label", "detail", "kind", "size", "ops"]), overridePath, findings);
      if (has(override, "label") && typeof override.label !== "string") findings.push(schema("step set label must be a string", pathKey(overridePath, "label")));
      if (has(override, "detail") && typeof override.detail !== "string") findings.push(schema("step set detail must be a string", pathKey(overridePath, "detail")));
      if (has(override, "kind") && !enumValid(override.kind, KINDS)) findings.push(schema("step set kind has an invalid value", pathKey(overridePath, "kind")));
      if (has(override, "ops") && typeof override.ops !== "boolean") findings.push(schema("step set ops must be a boolean", pathKey(overridePath, "ops")));
      if (has(override, "size")) checkSize(override.size, pathKey(overridePath, "size"), findings);
    });
  }

  function checkStep(value, path, findings) {
    const allowed = new Set(["id", "title", "summary", "navigateTo", "changes", "callout", "docs", "adr", "boundaries", "changed", "disclosure", "expandedPackages", "layout", "add", "remove", "set"]);
    if (!isObject(value)) { findings.push(schema("step must be an object", path)); return; }
    checkAdditional(value, allowed, path, findings);
    if (!idValid(value.id)) findings.push(schema("step requires a valid id", pathKey(path, "id")));
    if (typeof value.title !== "string" || !value.title.length) findings.push(schema("step requires a non-empty title", pathKey(path, "title")));
    if (has(value, "navigateTo") && !idValid(value.navigateTo)) findings.push(schema("step navigateTo must be a valid id", pathKey(path, "navigateTo")));
    if (has(value, "summary") && typeof value.summary !== "string") findings.push(schema("step summary must be a string", pathKey(path, "summary")));
    if (has(value, "changes") && (!Array.isArray(value.changes) || !value.changes.every(item => typeof item === "string"))) findings.push(schema("step changes must be an array of strings", pathKey(path, "changes")));
    if (has(value, "callout") && typeof value.callout !== "string") findings.push(schema("step callout must be a string", pathKey(path, "callout")));
    checkDocumentation(value, path, findings);
    if (has(value, "boundaries")) {
      if (!Array.isArray(value.boundaries)) findings.push(schema("step boundaries must be an array", pathKey(path, "boundaries")));
      else value.boundaries.forEach((boundary, index) => checkBoundary(boundary, pathIndex(pathKey(path, "boundaries"), index), findings));
    }
    if (has(value, "changed") && (!Array.isArray(value.changed) || !value.changed.every(idValid))) findings.push(schema("step changed must be an array of ids", pathKey(path, "changed")));
    if (has(value, "expandedPackages") && (!Array.isArray(value.expandedPackages) || !value.expandedPackages.every(idValid))) findings.push(schema("step expandedPackages must be an array of ids", pathKey(path, "expandedPackages")));
    if (has(value, "layout") && !["dagre", "elk", "force", "manual"].includes(value.layout)) findings.push(schema("step layout must be dagre, elk, force, or manual", pathKey(path, "layout")));
    if (has(value, "disclosure")) checkDisclosure(value.disclosure, pathKey(path, "disclosure"), findings);
    if (has(value, "add")) checkStepDelta(value.add, pathKey(path, "add"), findings);
    if (has(value, "remove")) checkStepDelta(value.remove, pathKey(path, "remove"), findings, true);
    if (has(value, "set")) checkStepSet(value.set, pathKey(path, "set"), findings);
  }

  function checkSteps(value, path, findings) {
    if (!isObject(value)) { findings.push(schema("steps must be an object", path)); return; }
    checkAdditional(value, new Set(["base", "sequence"]), path, findings);
    if (!has(value, "base")) findings.push(schema("steps requires base", pathKey(path, "base")));
    else checkState(value.base, pathKey(path, "base"), findings);
    if (!Array.isArray(value.sequence) || value.sequence.length < 1) findings.push(schema("steps sequence must contain at least one step", pathKey(path, "sequence")));
    else value.sequence.forEach((step, index) => checkStep(step, pathIndex(pathKey(path, "sequence"), index), findings));
  }

  function checkScenarios(value, path, findings) {
    if (!isObject(value)) { findings.push(schema("scenarios must be an object", path)); return; }
    checkAdditional(value, new Set(["base", "variants"]), path, findings);
    if (!has(value, "base")) findings.push(schema("scenarios requires base", pathKey(path, "base")));
    else checkState(value.base, pathKey(path, "base"), findings, true);
    if (!Array.isArray(value.variants) || value.variants.length < 1) findings.push(schema("scenarios variants must contain at least one variant", pathKey(path, "variants")));
    else value.variants.forEach((variant, index) => checkStep(variant, pathIndex(pathKey(path, "variants"), index), findings));
  }

  function schemaPass(doc) {
    const findings = [];
    if (!isObject(doc)) return [schema("must be an object")];
    const rootAllowed = new Set(["dsl", "meta", "canvas", "catalog", "packages", "system", "transition", "steps", "scenarios", "flow", "views"]);
    checkAdditional(doc, rootAllowed, "$", findings);
    if (!["transition-diagram/1.0", "transition-diagram/2.0"].includes(doc.dsl)) findings.push(schema("dsl must equal transition-diagram/1.0 or transition-diagram/2.0", pathKey("$", "dsl")));
    if (!isObject(doc.meta)) findings.push(schema("meta is required and must be an object", pathKey("$", "meta")));
    else {
      const allowed = new Set(["title", "subtitle", "layout", "minWireLen", "perspectives", "routing", "wireJumps", "composition", "comparison", "direction", "focusHops", "levels", "icons", "flow", "gif"]);
      checkAdditional(doc.meta, allowed, pathKey("$", "meta"), findings);
      if (typeof doc.meta.title !== "string" || !doc.meta.title.length) findings.push(schema("meta.title must be a non-empty string", pathKey(pathKey("$", "meta"), "title")));
      if (has(doc.meta, "subtitle") && typeof doc.meta.subtitle !== "string") findings.push(schema("subtitle must be a string", pathKey(pathKey("$", "meta"), "subtitle")));
      if (has(doc.meta, "layout") && !["auto", "dagre", "elk", "force", "manual"].includes(doc.meta.layout)) findings.push(schema("layout has an invalid value", pathKey(pathKey("$", "meta"), "layout")));
      if (has(doc.meta, "minWireLen") && !positiveNumber(doc.meta.minWireLen)) findings.push(schema("minWireLen must be positive", pathKey(pathKey("$", "meta"), "minWireLen")));
      if (has(doc.meta, "perspectives")) {
        const perspectivesPath = pathKey(pathKey("$", "meta"), "perspectives");
        if (!Array.isArray(doc.meta.perspectives) || !doc.meta.perspectives.every(id => PERSPECTIVES.includes(id))) findings.push(schema("perspectives must contain only supported perspective ids", perspectivesPath));
        if (Array.isArray(doc.meta.perspectives) && new Set(doc.meta.perspectives).size !== doc.meta.perspectives.length) findings.push(schema("perspectives must not contain duplicates", perspectivesPath));
      }
      if (has(doc.meta, "routing") && !["curved", "orthogonal", "direct"].includes(doc.meta.routing)) findings.push(schema("routing must be curved, orthogonal, or direct", pathKey(pathKey("$", "meta"), "routing")));
      if (has(doc.meta, "wireJumps") && !["arc", "gap", "none"].includes(doc.meta.wireJumps)) findings.push(schema("wireJumps must be arc, gap, or none", pathKey(pathKey("$", "meta"), "wireJumps")));
      if (has(doc.meta, "composition") && doc.meta.composition !== "scenarios") findings.push(schema("composition must be scenarios", pathKey(pathKey("$", "meta"), "composition")));
      if (has(doc.meta, "direction") && !["LR", "TB"].includes(doc.meta.direction)) findings.push(schema("direction must be LR or TB", pathKey(pathKey("$", "meta"), "direction")));
      if (has(doc.meta, "focusHops") && (!Number.isInteger(doc.meta.focusHops) || doc.meta.focusHops < 0)) findings.push(schema("focusHops must be a non-negative integer", pathKey(pathKey("$", "meta"), "focusHops")));
      if (has(doc.meta, "levels") && (!Array.isArray(doc.meta.levels) || doc.meta.levels.length < 1 || !doc.meta.levels.every(item => typeof item === "string"))) findings.push(schema("levels must be a non-empty string array", pathKey(pathKey("$", "meta"), "levels")));
      if (has(doc.meta, "icons")) checkIcons(doc.meta.icons, pathKey(pathKey("$", "meta"), "icons"), findings);
      if (has(doc.meta, "comparison")) checkComparison(doc.meta.comparison, pathKey(pathKey("$", "meta"), "comparison"), findings);
      if (has(doc.meta, "flow")) {
        const flowPath = pathKey(pathKey("$", "meta"), "flow");
        if (!isObject(doc.meta.flow)) findings.push(schema("flow must be an object", flowPath));
        else {
          checkAdditional(doc.meta.flow, new Set(["secondary", "mode", "secondaryRoute", "intro", "render", "autoAdvanceMs", "loop"]), flowPath, findings);
          if (has(doc.meta.flow, "secondary") && (!Array.isArray(doc.meta.flow.secondary) || !doc.meta.flow.secondary.every(type => WIRE_TYPES.includes(type)))) findings.push(schema("flow.secondary must contain wire types", pathKey(flowPath, "secondary")));
          if (has(doc.meta.flow, "mode") && !["deemphasize", "bundle", "hide"].includes(doc.meta.flow.mode)) findings.push(schema("flow.mode has an invalid value", pathKey(flowPath, "mode")));
          if (has(doc.meta.flow, "secondaryRoute") && !["direct", "bundle"].includes(doc.meta.flow.secondaryRoute)) findings.push(schema("flow.secondaryRoute has an invalid value", pathKey(flowPath, "secondaryRoute")));
          if (has(doc.meta.flow, "intro") && typeof doc.meta.flow.intro !== "boolean") findings.push(schema("flow.intro must be a boolean", pathKey(flowPath, "intro")));
          if (has(doc.meta.flow, "render") && !["stepwise", "all-steps", "single"].includes(doc.meta.flow.render)) findings.push(schema("flow.render must be stepwise, all-steps, or single", pathKey(flowPath, "render")));
          if (has(doc.meta.flow, "autoAdvanceMs") && !positiveNumber(doc.meta.flow.autoAdvanceMs)) findings.push(schema("flow.autoAdvanceMs must be positive", pathKey(flowPath, "autoAdvanceMs")));
          if (has(doc.meta.flow, "loop") && typeof doc.meta.flow.loop !== "boolean") findings.push(schema("flow.loop must be a boolean", pathKey(flowPath, "loop")));
        }
      }
      if (has(doc.meta, "gif")) {
        const gifPath = pathKey(pathKey("$", "meta"), "gif");
        if (!isObject(doc.meta.gif)) findings.push(schema("gif must be an object", gifPath));
        else {
          checkAdditional(doc.meta.gif, new Set(["fps", "maxDurationMs"]), gifPath, findings);
          if (has(doc.meta.gif, "fps") && (!positiveNumber(doc.meta.gif.fps) || doc.meta.gif.fps > 12)) findings.push(schema("gif.fps must be between 0 and 12", pathKey(gifPath, "fps")));
          if (has(doc.meta.gif, "maxDurationMs") && (!positiveNumber(doc.meta.gif.maxDurationMs) || doc.meta.gif.maxDurationMs > 10000)) findings.push(schema("gif.maxDurationMs must be between 0 and 10000", pathKey(gifPath, "maxDurationMs")));
        }
      }
    }
    if (!isObject(doc.catalog) || Object.keys(doc.catalog).length < 1) findings.push(schema("catalog is required and must contain at least one entry", pathKey("$", "catalog")));
    else Object.entries(doc.catalog).forEach(([id, entry]) => {
      const entryPath = pathKey(pathKey("$", "catalog"), id);
      if (!idValid(id)) findings.push(schema("catalog keys must be valid ids", entryPath));
      if (!isObject(entry)) { findings.push(schema("catalog entry must be an object", entryPath)); return; }
      checkAdditional(entry, new Set(["label", "type", "kind", "detail", "size", "level", "contains", "navigateTo", "ops"]), entryPath, findings);
      if (typeof entry.label !== "string" || !entry.label.length) findings.push(schema("catalog entry requires a non-empty label", pathKey(entryPath, "label")));
      const registeredTypes = new Set(Object.keys(doc.meta?.icons || {}));
      if (!idValid(entry.type) || (!enumValid(entry.type, NODE_TYPES) && !registeredTypes.has(entry.type))) findings.push(schema(`type must be a built-in or registered meta.icons type`, pathKey(entryPath, "type")));
      if (has(entry, "kind") && !enumValid(entry.kind, KINDS)) findings.push(schema("kind has an invalid value", pathKey(entryPath, "kind")));
      if (has(entry, "detail") && typeof entry.detail !== "string") findings.push(schema("detail must be a string", pathKey(entryPath, "detail")));
      if (has(entry, "level") && typeof entry.level !== "string") findings.push(schema("level must be a string", pathKey(entryPath, "level")));
      if (has(entry, "size")) checkSize(entry.size, pathKey(entryPath, "size"), findings);
      if (has(entry, "contains") && !idValid(entry.contains)) findings.push(schema("contains must be a valid id", pathKey(entryPath, "contains")));
      if (has(entry, "navigateTo") && !idValid(entry.navigateTo)) findings.push(schema("navigateTo must be a valid id", pathKey(entryPath, "navigateTo")));
      if (has(entry, "ops") && typeof entry.ops !== "boolean") findings.push(schema("catalog entry ops must be a boolean", pathKey(entryPath, "ops")));
    });
    if (has(doc, "canvas")) {
      const canvasPath = pathKey("$", "canvas");
      if (!isObject(doc.canvas)) findings.push(schema("canvas must be an object", canvasPath));
      else {
        checkAdditional(doc.canvas, new Set(["w", "h", "minWidth"]), canvasPath, findings);
        ["w", "h", "minWidth"].forEach(key => { if (has(doc.canvas, key) && !positiveNumber(doc.canvas[key])) findings.push(schema(`${key} must be positive`, pathKey(canvasPath, key))); });
      }
    }
    if (has(doc, "packages")) {
      const packagesPath = pathKey("$", "packages");
      if (!isObject(doc.packages)) findings.push(schema("packages must be an object", packagesPath));
      else Object.entries(doc.packages).forEach(([id, pkg]) => {
        const pkgPath = pathKey(packagesPath, id);
        if (!idValid(id)) findings.push(schema("package keys must be valid ids", pkgPath));
        if (!isObject(pkg)) { findings.push(schema("package must be an object", pkgPath)); return; }
        checkAdditional(pkg, new Set(["label", "level", "detail", "kind", "children", "ops"]), pkgPath, findings);
        if (typeof pkg.label !== "string" || !pkg.label.length) findings.push(schema("package requires a non-empty label", pathKey(pkgPath, "label")));
        if (!Array.isArray(pkg.children) || pkg.children.length < 1 || !pkg.children.every(idValid)) findings.push(schema("package children must be a non-empty id array", pathKey(pkgPath, "children")));
        if (has(pkg, "kind") && !enumValid(pkg.kind, KINDS)) findings.push(schema("package kind has an invalid value", pathKey(pkgPath, "kind")));
        if (has(pkg, "level") && typeof pkg.level !== "string") findings.push(schema("package level must be a string", pathKey(pkgPath, "level")));
        if (has(pkg, "detail") && typeof pkg.detail !== "string") findings.push(schema("package detail must be a string", pathKey(pkgPath, "detail")));
        if (has(pkg, "ops") && typeof pkg.ops !== "boolean") findings.push(schema("package ops must be a boolean", pathKey(pkgPath, "ops")));
      });
    }
    const hasSystem = has(doc, "system"), hasTransition = has(doc, "transition"), hasSteps = has(doc, "steps"), hasScenarios = has(doc, "scenarios"), hasFlow = has(doc, "flow"), hasViews = has(doc, "views");
    if (doc.dsl === "transition-diagram/1.0" && hasViews) findings.push(schema("transition-diagram/1.0 does not accept views; use transition-diagram/2.0", pathKey("$", "views")));
    if (doc.dsl === "transition-diagram/2.0" && !hasViews) findings.push(schema("transition-diagram/2.0 requires views", pathKey("$", "views")));
    if (hasViews) {
      if ([hasSystem, hasTransition, hasSteps, hasScenarios, hasFlow].some(Boolean)) findings.push(schema("views documents cannot also contain a legacy root composition", "$"));
      if (!Array.isArray(doc.views) || doc.views.length < 1) findings.push(schema("views must be a non-empty array", pathKey("$", "views")));
      else doc.views.forEach((view, index) => checkView(view, pathIndex(pathKey("$", "views"), index), findings));
    }
    if (!hasViews && [hasSystem, hasTransition, hasSteps, hasScenarios, hasFlow].filter(Boolean).length !== 1) {
      findings.push(schema("document must contain exactly one of system, transition, steps, scenarios, or flow", "$"));
    } else if (!hasViews && hasSystem) {
      checkState(doc.system, pathKey("$", "system"), findings, true);
    } else if (!hasViews && hasTransition) {
      const transitionPath = pathKey("$", "transition");
      if (!isObject(doc.transition)) findings.push(schema("transition must be an object", transitionPath));
      else {
        checkAdditional(doc.transition, new Set(["states"]), transitionPath, findings);
        if (!Array.isArray(doc.transition.states) || doc.transition.states.length < 2) findings.push(schema("transition.states is too short", pathKey(transitionPath, "states")));
        else doc.transition.states.forEach((state, index) => checkState(state, pathIndex(pathKey(transitionPath, "states"), index), findings));
      }
    } else if (!hasViews && hasSteps) {
      checkSteps(doc.steps, pathKey("$", "steps"), findings);
    } else if (!hasViews && hasScenarios) {
      checkScenarios(doc.scenarios, pathKey("$", "scenarios"), findings);
    } else if (!hasViews) {
      checkFlow(doc.flow, pathKey("$", "flow"), findings);
    }
    return findings;
  }

  function parseWireShorthand(text) {
    const match = /^(?:(security|control|compat|neutral):\s*)?(\S+)\s*(->|=>)\s*(\S+)(?:\s*:\s*(.+))?$/.exec(String(text).trim());
    if (!match) throw new Error(`wire-shorthand-parse-error: could not parse wire ${JSON.stringify(text)}`);
    const [, type, from, arrow, to, label] = match;
    const wire = { from, to, type: type || "data", flow: arrow === "=>" };
    if (label) wire.label = label.trim();
    return wire;
  }

  function normalizeWires(wires) {
    return arr(wires).filter(wire => typeof wire === "string" || isObject(wire)).map(wire => typeof wire === "string" ? parseWireShorthand(wire) : { ...wire });
  }

  function collectKnownIds(doc) {
    return new Set([...Object.keys(obj(doc.catalog)), ...Object.keys(obj(doc.packages))]);
  }

  function nodeId(entry) { return typeof entry === "string" ? entry : (isObject(entry) && typeof entry.id === "string" ? entry.id : null); }
  function nodeIds(entries) { return new Set(arr(entries).map(nodeId).filter(id => id !== null)); }

  function lintDuplicateIds(doc) {
    const findings = [], catalogIds = new Set(Object.keys(obj(doc.catalog))), packageIds = new Set(Object.keys(obj(doc.packages)));
    [...catalogIds].filter(id => packageIds.has(id)).sort().forEach(id => findings.push(finding("duplicate-id", `id '${id}' is defined in both catalog and packages`, `$.catalog.${id}`)));
    return findings;
  }

  function lintFrozenFieldOverrides(entries, pathPrefix) {
    const findings = [];
    arr(entries).forEach(entry => {
      if (!isObject(entry)) return;
      const extra = Object.keys(entry).filter(key => !NODE_OVERRIDE_KEYS.has(key)).sort();
      if (extra.length) findings.push(finding("frozen-field-override", `node override for '${entry.id || "?"}' sets [${extra.map(key => `'${key}'`).join(", ")}] -- only ['detail', 'kind', 'label', 'navigateTo', 'size'] may be overridden per state; type is identity, fixed once in catalog`, `${pathPrefix}.nodes`));
    });
    return findings;
  }

  function looksLikeUnquotedShorthand(wire) {
    if (!isObject(wire) || Object.keys(wire).length !== 1) return null;
    const [key, value] = Object.entries(wire)[0];
    return typeof key === "string" && (key.includes("->") || key.includes("=>")) && typeof value === "string" ? `"${key}: ${value}"` : null;
  }

  function lintWires(wires, knownIds, stateNodeIds, pathPrefix) {
    const findings = [];
    arr(wires).forEach(wire => {
      let normalized;
      if (typeof wire !== "string" && !isObject(wire)) return;
      if (typeof wire === "string") {
        try { normalized = parseWireShorthand(wire); }
        catch (error) { findings.push(finding("wire-shorthand-parse-error", error.message, `${pathPrefix}.wires`)); return; }
      } else {
        const suggestion = looksLikeUnquotedShorthand(wire);
        if (suggestion) { findings.push(finding("wire-shorthand-needs-quoting", `wire entry ${JSON.stringify(wire)} looks like an unquoted shorthand string -- quote the whole string, e.g. ${suggestion}`, `${pathPrefix}.wires`)); return; }
        normalized = { ...wire };
      }
      ["from", "to"].forEach(end => {
        if (typeof normalized[end] !== "string") return;
        if (!knownIds.has(normalized[end])) findings.push(finding("unknown-catalog-ref", `wire ${end} '${normalized[end]}' is not a catalog or package id`, `${pathPrefix}.wires`));
        else if (!stateNodeIds.has(normalized[end])) findings.push(finding("wire-endpoint-not-in-state", `wire ${end} '${normalized[end]}' is not present in this state's nodes`, `${pathPrefix}.wires`));
      });
    });
    return findings;
  }

  // A node listed twice in one state would be drawn twice; report each repeated id once.
  function lintDuplicateNodes(entries, pathPrefix) {
    const findings = [], seen = new Set(), reported = new Set();
    arr(entries).forEach(entry => {
      const id = nodeId(entry);
      if (id === null) return;
      if (seen.has(id) && !reported.has(id)) { reported.add(id); findings.push(finding("duplicate-state-node", `node '${id}' is listed more than once in this state`, `${pathPrefix}.nodes`)); }
      seen.add(id);
    });
    return findings;
  }

  function lintState(state, knownIds, packageIds, pathPrefix, duplicates = true) {
    const findings = [];
    if (!isObject(state)) return findings;
    const nodes = arr(state.nodes), stateNodeIds = nodeIds(nodes);
    if (duplicates) findings.push(...lintDuplicateNodes(nodes, pathPrefix));
    [...stateNodeIds].sort().forEach(id => { if (!knownIds.has(id)) findings.push(finding("unknown-catalog-ref", `node '${id}' is not a catalog or package id`, `${pathPrefix}.nodes`)); });
    findings.push(...lintFrozenFieldOverrides(nodes, pathPrefix));
    findings.push(...lintWires(state.wires, knownIds, stateNodeIds, pathPrefix));
    strs(state.changed).forEach(id => { if (!stateNodeIds.has(id)) findings.push(finding("bad-changed-ref", `changed id '${id}' is not in this state's nodes`, `${pathPrefix}.changed`)); });
    arr(state.boundaries).forEach(boundary => strs(obj(boundary).contains).forEach(member => { if (!knownIds.has(member)) findings.push(finding("unknown-catalog-ref", `boundary '${obj(boundary).id}' contains unknown id '${member}'`, `${pathPrefix}.boundaries`)); }));
    strs(state.expandedPackages).forEach(id => { if (!packageIds.has(id)) findings.push(finding("expanded-package-not-package", `expandedPackages id '${id}' is not a package id`, `${pathPrefix}.expandedPackages`)); });
    return findings;
  }

  function wireIdentity(value) {
    try {
      const wire = typeof value === "string" ? parseWireShorthand(value) : value;
      return isObject(wire) && typeof wire.from === "string" && typeof wire.to === "string" ? `${wire.from}>${wire.to}>${typeof wire.type === "string" ? wire.type : "data"}` : null;
    } catch (error) { return null; }
  }

  function lintSteps(stepsDoc, knownIds, packageIds, pathPrefix) {
    const findings = [];
    if (!isObject(stepsDoc) || !isObject(stepsDoc.base)) { findings.push(finding("step-base-required", "steps.base is required and must be a full state", `${pathPrefix}.base`)); return findings; }
    const current = JSON.parse(JSON.stringify(stepsDoc.base)), sequence = arr(stepsDoc.sequence);
    findings.push(...lintState(current, knownIds, packageIds, `${pathPrefix}.base`));
    if (sequence.length < 1) findings.push(finding("step-sequence-too-short", "steps.sequence must contain at least one step", `${pathPrefix}.sequence`));
    const seenStepIds = new Set();
    sequence.forEach((step, index) => {
      if (!isObject(step)) return;
      const path = `${pathPrefix}.sequence[${index}]`, stepId = step.id;
      if (typeof stepId === "string") {
        if (seenStepIds.has(stepId)) findings.push(finding("duplicate-id", `step id '${stepId}' appears more than once`, `${path}.id`));
        seenStepIds.add(stepId);
      }
      const currentNodes = nodeIds(current.nodes), currentWires = (() => { try { return normalizeWires(current.wires); } catch (error) { return []; } })(), currentWireKeys = new Set(currentWires.map(wireIdentity)), add = isObject(step.add) ? step.add : {}, remove = isObject(step.remove) ? step.remove : {}, overrides = isObject(step.set) ? step.set : {}, addNodes = arr(add.nodes), addWires = arr(add.wires), removeNodes = new Set(strs(remove.nodes)), removeWires = arr(remove.wires);
      addNodes.forEach(node => { const id = nodeId(node); if (currentNodes.has(id)) findings.push(finding("step-add-existing-node", `step adds node '${id}', but it already exists`, `${path}.add.nodes`)); });
      removeNodes.forEach(id => { if (!currentNodes.has(id)) findings.push(finding("step-remove-absent", `step removes node '${id}', but it is absent`, `${path}.remove.nodes`)); });
      removeWires.forEach(wire => { const identity = wireIdentity(wire); if (identity && !currentWireKeys.has(identity)) findings.push(finding("step-remove-absent", `step removes wire '${identity}', but it is absent`, `${path}.remove.wires`)); if (identity && (removeNodes.has(identity.split(">", 2)[0]) || removeNodes.has(identity.split(">", 2)[1]))) findings.push(finding("step-removes-connected-node", "step removes a wire still connected to node(s) being removed", `${path}.remove.wires`)); });
      addWires.forEach(wire => { const identity = wireIdentity(wire); if (identity && (removeNodes.has(identity.split(">", 2)[0]) || removeNodes.has(identity.split(">", 2)[1]))) findings.push(finding("step-removes-connected-node", "step adds a wire still connected to node(s) being removed", `${path}.add.wires`)); });
      strs(step.changed).forEach(id => { if (removeNodes.has(id)) findings.push(finding("step-removes-connected-node", `step marks removed node '${id}' as changed`, `${path}.changed`)); });
      Object.keys(overrides).forEach(id => { if (!currentNodes.has(id)) findings.push(finding("step-set-unknown-node", `step sets node '${id}', but it is not present`, `${path}.set`)); else if (removeNodes.has(id)) findings.push(finding("step-removes-connected-node", `step sets node '${id}' while removing it`, `${path}.set`)); });
      current.nodes = arr(current.nodes).filter(node => !removeNodes.has(nodeId(node))).concat(JSON.parse(JSON.stringify(addNodes)));
      const removeWireKeys = new Set(removeWires.map(wireIdentity));
      current.wires = arr(current.wires).filter(wire => { const identity = wireIdentity(wire); return !removeWireKeys.has(identity) && !(identity && (removeNodes.has(identity.split(">", 2)[0]) || removeNodes.has(identity.split(">", 2)[1]))); }).concat(JSON.parse(JSON.stringify(addWires)));
      Object.entries(overrides).forEach(([id, override]) => { const nodeIndex = current.nodes.findIndex(node => nodeId(node) === id); if (nodeIndex >= 0) current.nodes[nodeIndex] = { ...(typeof current.nodes[nodeIndex] === "string" ? { id } : JSON.parse(JSON.stringify(current.nodes[nodeIndex]))), ...JSON.parse(JSON.stringify(override || {})) }; });
      ["id", "title", "summary", "changes", "callout", "boundaries", "changed", "disclosure", "expandedPackages", "layout"].forEach(key => { if (has(step, key)) current[key] = JSON.parse(JSON.stringify(step[key])); });
      findings.push(...lintState(current, knownIds, packageIds, path, false));
    });
    return findings;
  }

  function lintScenarios(scenariosDoc, knownIds, packageIds, pathPrefix) {
    const findings = [];
    if (!isObject(scenariosDoc) || !isObject(scenariosDoc.base)) { findings.push(finding("scenario-base-required", "scenarios.base is required and must be a full state", `${pathPrefix}.base`)); return findings; }
    const variants = scenariosDoc.variants || [];
    if (!Array.isArray(variants) || variants.length < 1) { findings.push(finding("scenario-variants-too-short", "scenarios.variants must contain at least one variant", `${pathPrefix}.variants`)); return findings; }
    const base = JSON.parse(JSON.stringify(scenariosDoc.base)); if (!base.id) base.id = "base";
    return findings.concat(lintSteps({ base, sequence: variants }, knownIds, packageIds, pathPrefix));
  }

  function lintFlow(flow, knownIds, pathPrefix) {
    const findings = [];
    if (!isObject(flow)) return findings;
    const nodes = arr(flow.nodes), flowNodeIds = nodeIds(nodes);
    findings.push(...lintDuplicateNodes(nodes, pathPrefix));
    [...flowNodeIds].sort().forEach(id => { if (!knownIds.has(id)) findings.push(finding("unknown-catalog-ref", `node '${id}' is not a catalog or package id`, `${pathPrefix}.nodes`)); });
    findings.push(...lintFrozenFieldOverrides(nodes, pathPrefix));
    findings.push(...lintWires(flow.wires, knownIds, flowNodeIds, pathPrefix));
    let wires = [];
    try { wires = normalizeWires(flow.wires); } catch (error) { /* lintWires already reports the parse rule */ }
    const known = new Set(wires.filter(wire => typeof wire.from === "string" && typeof wire.to === "string").map(wire => `${wire.from}>${wire.to}`)), seenCalls = new Set();
    const checkEdge = (text, kind, edgePath) => {
      let edge;
      try { edge = parseWireShorthand(text); } catch (error) { findings.push(finding("flow-step-unknown-edge", `flow step edge '${text}' is not a valid wire shorthand`, edgePath)); return; }
      const key = `${edge.from}>${edge.to}`, reverse = `${edge.to}>${edge.from}`, syntheticLoop = kind === "loop" && edge.from === edge.to;
      if (!flowNodeIds.has(edge.from) || !flowNodeIds.has(edge.to) || (!known.has(key) && !(kind === "return" && known.has(reverse)) && !syntheticLoop)) findings.push(finding("flow-step-unknown-edge", `flow step edge '${text}' is not present in flow.wires`, edgePath));
      if (kind === "return" && !seenCalls.has(reverse)) findings.push(finding("flow-return-no-forward", `return edge '${text}' has no earlier forward call`, edgePath));
      else if (kind !== "return" && known.has(key)) seenCalls.add(key);
    };
    const checkStep = (step, path) => {
      if (!isObject(step)) return;
      const kind = step.kind || "call";
      if (typeof step.edge === "string") checkEdge(step.edge, kind, `${path}.edge`);
      else if (Array.isArray(step.group)) step.group.forEach((edge, index) => { if (typeof edge === "string") checkEdge(edge, kind, `${path}.group[${index}]`); });
      else if (Array.isArray(step.parallel)) step.parallel.forEach((child, index) => checkStep(child, `${path}.parallel[${index}]`));
      else findings.push(finding("flow-step-empty", "flow step must contain edge, group, or parallel", path));
    };
    arr(flow.steps).forEach((step, index) => checkStep(step, `${pathPrefix}.steps[${index}]`));
    arr(flow.boundaries).forEach(boundary => strs(obj(boundary).contains).forEach(member => { if (!knownIds.has(member)) findings.push(finding("unknown-catalog-ref", `boundary '${obj(boundary).id}' contains unknown id '${member}'`, `${pathPrefix}.boundaries`)); }));
    return findings;
  }

  function lintDeployment(view, pathPrefix, knownIds) {
    const findings = [], deployment = obj(view.deployment), infrastructure = deployment.infrastructure, parents = new Map();
    if (!isObject(infrastructure) || !Object.keys(infrastructure).length) { findings.push(finding("deployment-infrastructure-empty", "deployment.infrastructure must be a non-empty map", `${pathPrefix}.deployment.infrastructure`)); return findings; }
    Object.entries(infrastructure).forEach(([id, item]) => strs(obj(item).children).forEach(child => {
      if (!has(infrastructure, child)) findings.push(finding("deployment-unknown-infrastructure", `infrastructure child '${child}' is not declared`, `${pathPrefix}.deployment.infrastructure.${id}.children`));
      else { if (!parents.has(child)) parents.set(child, []); parents.get(child).push(id); }
    }));
    parents.forEach((items, child) => { if (items.length > 1) findings.push(finding("deployment-infrastructure-multiple-parents", `infrastructure node '${child}' has multiple parents: [${items.join(", ")}]`, `${pathPrefix}.deployment.infrastructure.${child}`)); });
    const visiting = new Set(), visited = new Set();
    function visit(id, trail) {
      if (visiting.has(id)) { const start = trail.indexOf(id); findings.push(finding("deployment-infrastructure-cycle", `infrastructure nesting contains a cycle: ${trail.slice(start).join(" -> ")}`, `${pathPrefix}.deployment.infrastructure.${id}.children`)); return; }
      if (visited.has(id) || !has(infrastructure, id)) return;
      visiting.add(id); strs(obj(infrastructure[id]).children).forEach(child => visit(child, [...trail, child])); visiting.delete(id); visited.add(id);
    }
    Object.keys(infrastructure).forEach(id => visit(id, [id]));
    const selected = nodeIds(view.nodes), leaves = new Set(Object.entries(infrastructure).filter(([, item]) => !arr(obj(item).children).length).map(([id]) => id)), placed = new Map();
    const seenPlacements = new Set();
    arr(deployment.placements).forEach((placement, index) => {
      if (!isObject(placement) || typeof placement.component !== "string" || typeof placement.target !== "string") return;
      const path = `${pathPrefix}.deployment.placements[${index}]`, replicas = placement.replicas === undefined ? 1 : placement.replicas;
      const placementKey = `${placement.component}>${placement.target}`;
      if (seenPlacements.has(placementKey)) findings.push(finding("deployment-duplicate-placement", `placement for component '${placement.component}' on target '${placement.target}' is repeated; combine replicas into one placement`, path));
      seenPlacements.add(placementKey);
      if (!selected.has(placement.component)) findings.push(finding("deployment-unknown-component", `placement component '${placement.component}' is not selected by the view`, `${path}.component`));
      if (!has(infrastructure, placement.target)) findings.push(finding("deployment-unknown-target", `placement target '${placement.target}' is not declared`, `${path}.target`));
      else if (!leaves.has(placement.target)) findings.push(finding("deployment-nonleaf-target", `placement target '${placement.target}' must be an infrastructure leaf`, `${path}.target`));
      if (!Number.isInteger(replicas) || replicas < 1) findings.push(finding("deployment-replica-invalid", "placement replicas must be a positive integer", `${path}.replicas`));
      else if (selected.has(placement.component)) placed.set(placement.component, (placed.get(placement.component) || 0) + replicas);
    });
    [...selected].forEach(component => { if (!placed.get(component)) findings.push(finding("deployment-unplaced-component", `selected component '${component}' has no placement`, `${pathPrefix}.deployment.placements`)); });
    return findings;
  }

  function lintView(view, knownIds, packageIds, pathPrefix) {
    if (!isObject(view)) return [finding("view-invalid", "view must be an object", pathPrefix)];
    const mode = view.mode, findings = [];
    if (mode === "system") findings.push(...lintState(view, knownIds, packageIds, pathPrefix));
    else if (mode === "transition") {
      const seenStateIds = new Set();
      arr(view.states).forEach((state, index) => {
        const stateId = isObject(state) && typeof state.id === "string" ? state.id : null;
        if (stateId !== null && seenStateIds.has(stateId)) findings.push(finding("duplicate-id", `state id '${stateId}' appears more than once`, `${pathPrefix}.states[${index}].id`));
        if (stateId !== null) seenStateIds.add(stateId);
        findings.push(...lintState(state, knownIds, packageIds, `${pathPrefix}.states[${index}]`));
      });
    }
    else if (mode === "steps") findings.push(...lintSteps(view, knownIds, packageIds, pathPrefix));
    else if (mode === "scenarios") findings.push(...lintScenarios(view, knownIds, packageIds, pathPrefix));
    else if (mode === "flow") findings.push(...lintFlow(view, knownIds, pathPrefix));
    else if (mode === "deployment") { findings.push(...lintState(view, knownIds, packageIds, pathPrefix)); findings.push(...lintDeployment(view, pathPrefix, knownIds)); }
    else findings.push(finding("view-mode-required", "view.mode must be system, transition, steps, scenarios, flow, or deployment", `${pathPrefix}.mode`));
    return findings;
  }

  function lintNavigationTargets(doc, viewIds) {
    const findings = [], packageIds = new Set(Object.keys(obj(doc.packages)));
    const checkCatalogEntry = (id, entry) => {
      if (!isObject(entry)) return;
      const path = `$.catalog.${id}`;
      if (typeof entry.navigateTo === "string" && !viewIds.has(entry.navigateTo)) findings.push(finding("navigation-target-unknown", `catalog node '${id}' navigates to unknown view '${entry.navigateTo}'`, `${path}.navigateTo`));
      if (typeof entry.contains === "string" && !packageIds.has(entry.contains) && !viewIds.has(entry.contains)) findings.push(finding("contains-target-unknown", `catalog node '${id}' contains unknown package or view '${entry.contains}'`, `${path}.contains`));
    };
    const checkNodeEntries = (entries, path) => arr(entries).forEach((entry, index) => {
      if (!isObject(entry) || typeof entry.navigateTo !== "string" || viewIds.has(entry.navigateTo)) return;
      findings.push(finding("navigation-target-unknown", `node override navigates to unknown view '${entry.navigateTo}'`, `${path}[${index}].navigateTo`));
    });
    const checkStep = (step, path) => {
      if (!isObject(step)) return;
      if (typeof step.navigateTo === "string" && !viewIds.has(step.navigateTo)) findings.push(finding("navigation-target-unknown", `step navigates to unknown view '${step.navigateTo}'`, `${path}.navigateTo`));
      arr(step.parallel).forEach((child, index) => checkStep(child, `${path}.parallel[${index}]`));
    };
    const checkState = (state, path) => { if (!isObject(state)) return; if (typeof state.navigateTo === "string" && !viewIds.has(state.navigateTo)) findings.push(finding("navigation-target-unknown", `state navigates to unknown view '${state.navigateTo}'`, `${path}.navigateTo`)); checkNodeEntries(state.nodes, `${path}.nodes`); };
    Object.entries(obj(doc.catalog)).forEach(([id, entry]) => checkCatalogEntry(id, entry));
    (Array.isArray(doc.views) ? doc.views : []).forEach((view, index) => {
      if (!isObject(view)) return;
      const path = `$.views[${index}]`;
      checkNodeEntries(view.nodes, `${path}.nodes`);
      if (view.mode === "transition") arr(view.states).forEach((state, stateIndex) => checkState(state, `${path}.states[${stateIndex}]`));
      else if (view.mode === "steps") { checkState(view.base, `${path}.base`); arr(view.sequence).forEach((step, stepIndex) => checkStep(step, `${path}.sequence[${stepIndex}]`)); }
      else if (view.mode === "scenarios") { checkState(view.base, `${path}.base`); arr(view.variants).forEach((step, stepIndex) => checkStep(step, `${path}.variants[${stepIndex}]`)); }
      else if (view.mode === "flow") arr(view.steps).forEach((step, stepIndex) => checkStep(step, `${path}.steps[${stepIndex}]`));
    });
    return findings;
  }

  function lintComparison(doc, viewIds) {
    const findings = [], comparison = doc.meta?.comparison;
    if (comparison === undefined || comparison === null) return findings;
    if (!Array.isArray(doc.views)) { findings.push(finding("comparison-requires-views", "meta.comparison requires a v2 views bundle", "$.meta.comparison")); return findings; }
    const criteria = Array.isArray(comparison.criteria) ? comparison.criteria : [], criterionIds = new Set();
    criteria.forEach((criterion, index) => {
      if (!isObject(criterion)) return;
      if (typeof criterion.id === "string" && criterionIds.has(criterion.id)) findings.push(finding("comparison-duplicate-criterion", `comparison criterion id '${criterion.id}' appears more than once`, `$.meta.comparison.criteria[${index}].id`));
      if (typeof criterion.id === "string") criterionIds.add(criterion.id);
    });
    if (typeof comparison.recommended === "string" && !viewIds.has(comparison.recommended)) findings.push(finding("comparison-recommended-unknown", `comparison recommended view '${comparison.recommended}' is not in views`, "$.meta.comparison.recommended"));
    doc.views.forEach((view, index) => {
      const tradeoffs = view?.comparison?.tradeoffs;
      if (!isObject(tradeoffs)) return;
      Object.entries(tradeoffs).forEach(([criterion, value]) => {
        const path = `$.views[${index}].comparison.tradeoffs.${criterion}`;
        if (typeof criterion === "string" && !criterionIds.has(criterion)) findings.push(finding("comparison-criterion-unknown", `view tradeoff refers to unknown comparison criterion '${criterion}'`, path));
        if (isObject(value) && value.rating !== undefined && (!numberValid(value.rating) || value.rating < 0 || value.rating > 5)) findings.push(finding("comparison-rating-invalid", "comparison rating must be a number from 0 to 5", `${path}.rating`));
      });
    });
    return findings;
  }

  function checkDeployment(value, path, findings) {
    if (!isObject(value)) { findings.push(schema("deployment must be an object", path)); return; }
    checkAdditional(value, new Set(["infrastructure", "placements"]), path, findings);
    const infraPath = pathKey(path, "infrastructure");
    if (!isObject(value.infrastructure) || !Object.keys(value.infrastructure).length) { findings.push(schema("deployment.infrastructure must be a non-empty object", infraPath)); return; }
    Object.entries(value.infrastructure).forEach(([id, item]) => {
      const itemPath = pathKey(infraPath, id);
      if (!idValid(id)) findings.push(schema("infrastructure keys must be valid ids", itemPath));
      if (!isObject(item)) { findings.push(schema("infrastructure entry must be an object", itemPath)); return; }
      checkAdditional(item, new Set(["label", "kind", "children", "detail", "size", "ops"]), itemPath, findings);
      if (typeof item.label !== "string" || !item.label.length) findings.push(schema("infrastructure entry requires a non-empty label", pathKey(itemPath, "label")));
      if (!enumValid(item.kind, ["region", "cluster", "host", "runtime", "network"])) findings.push(schema("infrastructure kind has an invalid value", pathKey(itemPath, "kind")));
      if (has(item, "children") && (!Array.isArray(item.children) || !item.children.length || !item.children.every(idValid))) findings.push(schema("infrastructure children must be a non-empty id array", pathKey(itemPath, "children")));
      if (has(item, "detail") && typeof item.detail !== "string") findings.push(schema("infrastructure detail must be a string", pathKey(itemPath, "detail")));
      if (has(item, "size")) checkSize(item.size, pathKey(itemPath, "size"), findings);
      if (has(item, "ops") && typeof item.ops !== "boolean") findings.push(schema("infrastructure ops must be a boolean", pathKey(itemPath, "ops")));
    });
    const placementsPath = pathKey(path, "placements");
    if (!Array.isArray(value.placements) || value.placements.length < 1) findings.push(schema("deployment.placements must be a non-empty array", placementsPath));
    else value.placements.forEach((placement, index) => {
      const placementPath = pathIndex(placementsPath, index);
      if (!isObject(placement)) { findings.push(schema("placement must be an object", placementPath)); return; }
      checkAdditional(placement, new Set(["component", "target", "replicas", "label"]), placementPath, findings);
      if (!idValid(placement.component)) findings.push(schema("placement component must be a valid id", pathKey(placementPath, "component")));
      if (!idValid(placement.target)) findings.push(schema("placement target must be a valid id", pathKey(placementPath, "target")));
      if (has(placement, "replicas") && (!Number.isInteger(placement.replicas) || placement.replicas < 1)) findings.push(schema("placement replicas must be a positive integer", pathKey(placementPath, "replicas")));
      if (has(placement, "label") && typeof placement.label !== "string") findings.push(schema("placement label must be a string", pathKey(placementPath, "label")));
    });
  }

  function checkView(value, path, findings) {
    if (!isObject(value)) { findings.push(schema("view must be an object", path)); return; }
    checkAdditional(value, new Set(["id", "mode", "title", "summary", "callout", "layout", "docs", "adr", "boundaries", "nodes", "wires", "states", "base", "sequence", "variants", "steps", "disclosure", "expandedPackages", "deployment", "comparison"]), path, findings);
    if (!idValid(value.id)) findings.push(schema("view id must be a valid id", pathKey(path, "id")));
    if (!enumValid(value.mode, ["system", "transition", "steps", "scenarios", "flow", "deployment"])) findings.push(schema("view mode has an invalid value", pathKey(path, "mode")));
    if (typeof value.title !== "string" || !value.title.length) findings.push(schema("view title must be a non-empty string", pathKey(path, "title")));
    if (has(value, "layout") && !["dagre", "elk", "force", "manual"].includes(value.layout)) findings.push(schema("view layout must be dagre, elk, force, or manual", pathKey(path, "layout")));
    if (has(value, "summary") && typeof value.summary !== "string") findings.push(schema("view summary must be a string", pathKey(path, "summary")));
    if (has(value, "callout") && typeof value.callout !== "string") findings.push(schema("view callout must be a string", pathKey(path, "callout")));
    checkDocumentation(value, path, findings);
    const stateValue = () => { const state = { ...value }; delete state.mode; delete state.states; delete state.base; delete state.sequence; delete state.variants; delete state.steps; delete state.deployment; delete state.comparison; return state; };
    if (value.mode === "system" || value.mode === "deployment") checkState(stateValue(), path, findings, value.mode === "system");
    else if (value.mode === "transition") {
      if (!Array.isArray(value.states) || value.states.length < 2) findings.push(schema("view.states must contain at least two states", pathKey(path, "states")));
      else value.states.forEach((state, index) => checkState(state, pathIndex(pathKey(path, "states"), index), findings));
    } else if (value.mode === "steps") {
      if (!isObject(value.base)) findings.push(schema("steps view requires base", pathKey(path, "base"))); else checkState(value.base, pathKey(path, "base"), findings);
      if (!Array.isArray(value.sequence) || value.sequence.length < 1) findings.push(schema("steps view sequence must be non-empty", pathKey(path, "sequence"))); else value.sequence.forEach((step, index) => checkStep(step, pathIndex(pathKey(path, "sequence"), index), findings));
    } else if (value.mode === "scenarios") {
      if (!isObject(value.base)) findings.push(schema("scenarios view requires base", pathKey(path, "base"))); else checkState(value.base, pathKey(path, "base"), findings, true);
      if (!Array.isArray(value.variants) || value.variants.length < 1) findings.push(schema("scenarios view variants must be non-empty", pathKey(path, "variants"))); else value.variants.forEach((variant, index) => checkStep(variant, pathIndex(pathKey(path, "variants"), index), findings));
    } else if (value.mode === "flow") {
      const flowValue = stateValue(); flowValue.steps = value.steps; checkFlow(flowValue, path, findings);
    }
    if (value.mode === "deployment") checkDeployment(value.deployment, pathKey(path, "deployment"), findings);
    if (has(value, "comparison")) checkComparisonView(value.comparison, pathKey(path, "comparison"), findings);
  }

  function lintPackageGraph(doc) {
    const findings = [], packages = obj(doc.packages), parents = new Map();
    const childrenOf = pkg => isObject(pkg) ? strs(pkg.children) : [];
    const knownIds = new Set([...Object.keys(obj(doc.catalog)), ...Object.keys(packages)]);
    Object.entries(packages).forEach(([packageId, pkg]) => childrenOf(pkg).forEach(child => {
      if (!knownIds.has(child)) return;
      if (!parents.has(child)) parents.set(child, []);
      parents.get(child).push(packageId);
    }));
    [...parents.entries()].forEach(([child, packageParents]) => { if (packageParents.length > 1) findings.push(finding("package-multiple-parents", `package '${child}' is nested under multiple packages: [${packageParents.sort().map(id => `'${id}'`).join(", ")}]`, `$.packages.${child}`)); });
    const visiting = new Set(), visited = new Set();
    function visit(packageId, trail) {
      if (visiting.has(packageId)) {
        const cycleStart = trail.indexOf(packageId), cycle = trail.slice(cycleStart);
        findings.push(finding("package-cycle", `package nesting contains a cycle: ${cycle.join(" -> ")}`, `$.packages.${packageId}.children`));
        return;
      }
      if (visited.has(packageId)) return;
      visiting.add(packageId);
      childrenOf(packages[packageId]).filter(child => packages[child]).forEach(child => visit(child, [...trail, child]));
      visiting.delete(packageId); visited.add(packageId);
    }
    Object.keys(packages).forEach(id => visit(id, [id]));
    return findings;
  }

  function lintPass(doc) {
    const findings = [], hasSystem = has(doc, "system"), hasTransition = has(doc, "transition"), hasSteps = has(doc, "steps"), hasScenarios = has(doc, "scenarios"), hasFlow = has(doc, "flow"), hasViews = has(doc, "views");
    if (!hasSystem && !hasTransition && !hasSteps && !hasScenarios && !hasFlow && !hasViews) findings.push(finding("mode-required", "document has neither system:, transition:, steps:, scenarios:, flow:, nor views:", "$"));
    findings.push(...lintDuplicateIds(doc), ...lintPackageGraph(doc));
    const knownIds = collectKnownIds(doc), packageIds = new Set(Object.keys(obj(doc.packages)));
    Object.entries(obj(doc.packages)).forEach(([packageId, pkg]) => (isObject(pkg) ? strs(pkg.children) : []).forEach(child => { if (!knownIds.has(child)) findings.push(finding("unknown-catalog-ref", `package '${packageId}' child '${child}' is not a catalog or package id`, `$.packages.${packageId}.children`)); }));
    if (hasViews) {
      const seen = new Set();
      if (!Array.isArray(doc.views) || !doc.views.length) findings.push(finding("views-required", "views must be a non-empty array", "$.views"));
      else doc.views.forEach((view, index) => { const viewId = isObject(view) && typeof view.id === "string" ? view.id : null; if (viewId !== null) { if (seen.has(viewId)) findings.push(finding("duplicate-id", `view id '${viewId}' appears more than once`, `$.views[${index}].id`)); seen.add(viewId); } findings.push(...lintView(view, knownIds, packageIds, `$.views[${index}]`)); });
      findings.push(...lintNavigationTargets(doc, seen));
      findings.push(...lintComparison(doc, seen));
      return findings;
    }
    if (hasSystem) findings.push(...lintState(doc.system, knownIds, packageIds, "$.system"));
    if (hasTransition) {
      const states = arr(obj(doc.transition).states);
      if (states.length < 2) findings.push(finding("transition-too-short", "transition.states has fewer than 2 entries -- use system: instead", "$.transition.states"));
      const seen = new Set();
      states.forEach((state, index) => {
        const stateId = isObject(state) && typeof state.id === "string" ? state.id : null;
        if (stateId !== null && seen.has(stateId)) findings.push(finding("duplicate-id", `state id '${stateId}' appears more than once`, `$.transition.states[${index}]`));
        if (stateId !== null) seen.add(stateId);
        findings.push(...lintState(state, knownIds, packageIds, `$.transition.states[${index}]`));
      });
    }
    if (hasSteps) findings.push(...lintSteps(doc.steps, knownIds, packageIds, "$.steps"));
    if (hasScenarios) findings.push(...lintScenarios(doc.scenarios, knownIds, packageIds, "$.scenarios"));
    if (hasFlow) findings.push(...lintFlow(doc.flow, knownIds, "$.flow"));
    return findings;
  }

  function validateDocument(doc) {
    const findings = schemaPass(doc);
    if (isObject(doc)) findings.push(...lintPass(doc));
    return findings;
  }

  function parseErrorFinding(error) {
    const message = String(error && error.message || error);
    return finding(message.toLowerCase().includes("duplicat") ? "duplicate-yaml-key" : "yaml-parse-error", message, "$");
  }

  global.TransitionDiagramValidator = {
    parseWireShorthand,
    normalizeWires,
    validateDocument,
    parseErrorFinding,
    schemaPass,
    lintPass,
    configureSchema,
    get schema() { return SCHEMA; },
  };
})(typeof window !== "undefined" ? window : globalThis);
