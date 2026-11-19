/*
 * Shared architecture visual language.
 * Keep this file beside generated diagrams. It is the single source of truth
 * for semantic flow styles and node icon geometry.
 */
(function (root) {
  const styles = Object.freeze({
    colors: Object.freeze({
      bg: "#f6f7fb", panel: "#ffffff", ink: "#1c2130", muted: "#5b6478", line: "#d8dce6",
      data: "#0f9bb5", dataFill: "#e2f6fa", security: "#d2337b", securityFill: "#fde7f1",
      control: "#7657c7", controlFill: "#eee9ff", existing: "#b87100", existingFill: "#fff4e0",
      retired: "#8a93a6", retiredFill: "#eef0f4", neutral: "#7a8399", glow: "#3b82f6",
      boundary: "#6b7390"
    }),
    flows: Object.freeze({
      data: { label: "Data flow", color: "var(--data)", width: 2.6, dash: "none" },
      security: { label: "Authentication / security", color: "var(--security)", width: 2.2, dash: "8 5" },
      control: { label: "Control / configuration", color: "var(--control)", width: 2.2, dash: "3 5" },
      neutral: { label: "Supporting call", color: "var(--neutral)", width: 1.6, dash: "none" },
      compat: { label: "Temporary compatibility", color: "var(--existing)", width: 2.2, dash: "10 6" }
    }),
    kinds: Object.freeze({
      existing: { stroke: "var(--existing)", fill: "var(--existing-fill)" },
      new: { stroke: "var(--data)", fill: "var(--data-fill)" },
      mixed: { stroke: "var(--data)", fill: "var(--existing-fill)" },
      security: { stroke: "var(--security)", fill: "var(--security-fill)" },
      retired: { stroke: "var(--retired)", fill: "var(--retired-fill)" }
    })
  });

  // Markup is intentionally fixed: diagrams select an icon by semantic type,
  // never by inventing a one-off shape in the generated file.
  const icons = Object.freeze({
    actor: { viewBox: "0 0 24 24", markup: '<circle cx="12" cy="7" r="3.2"/><path d="M5 20c.6-4 2.8-6 7-6s6.4 2 7 6"/>' },
    service: { viewBox: "0 0 24 24", markup: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h5M8 17h8"/>' },
    agent: { viewBox: "0 0 24 24", markup: '<path d="M5 9.5a7 7 0 0 1 14 0v5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z"/><path d="M8 9h8M9 13h.01M15 13h.01M12 3v2"/>' },
    database: { viewBox: "0 0 24 24", markup: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>' },
    queue: { viewBox: "0 0 24 24", markup: '<path d="M5 5h12v4H5zM5 10h12v4H5zM5 15h8v4H5z"/><path d="M19 5v14m0 0-2-2m2 2 2-2"/>' },
    external: { viewBox: "0 0 24 24", markup: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 10h8M8 14h5M12 3v3M12 18v3"/>' },
    package: { viewBox: "0 0 24 24", markup: '<path d="m4 8 8-4 8 4v9l-8 4-8-4z"/><path d="m4 8 8 4 8-4M12 12v9"/>' },
    gateway: { viewBox: "0 0 24 24", markup: '<path d="M4 6h16v12H4z"/><path d="M8 10h8M8 14h4M12 6v12"/>' },
    security: { viewBox: "0 0 24 24", markup: '<path d="M12 3 19 6v5c0 4.4-2.8 7.8-7 10-4.2-2.2-7-5.6-7-10V6z"/><path d="m9 12 2 2 4-4"/>' },
    llm: { viewBox: "0 0 24 24", markup: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><rect x="6" y="6" width="12" height="12" rx="3"/><path d="m12 8.5 1.1 2.4 2.4 1.1-2.4 1.1L12 15.5l-1.1-2.4L8.5 12l2.4-1.1z"/>' },
    "vector-store": { viewBox: "0 0 24 24", markup: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="12" cy="17" r="1"/><path d="m9 13 3 4 3-5"/>' },
    tool: { viewBox: "0 0 24 24", markup: '<path d="M14.5 4.5a4 4 0 0 0-5 5L4 15v5h5l5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-3-3z"/>' }
  });

  const typeToIcon = Object.freeze({
    actor: "actor", user: "actor", service: "service", function: "service", gateway: "gateway",
    agent: "agent", db: "database", database: "database", cache: "database", queue: "queue",
    topic: "queue", external: "external", provider: "external", package: "package",
    security: "security", idp: "security", llm: "llm", model: "llm", "vector-store": "vector-store",
    tool: "tool"
  });

  function createLibrary(registered) {
    const mergedIcons = { ...icons }, mergedTypeToIcon = { ...typeToIcon };
    Object.entries(registered || {}).forEach(([type, definition]) => {
      if (typeof definition === "string" && icons[definition]) mergedTypeToIcon[type] = definition;
      else if (definition && typeof definition === "object" && definition.viewBox && definition.markup) {
        mergedIcons[type] = { viewBox: definition.viewBox, markup: definition.markup };
        mergedTypeToIcon[type] = type;
      }
    });
    const library = {
      version: "1.0.0",
      styles,
      icons: Object.freeze(mergedIcons),
      typeToIcon: Object.freeze(mergedTypeToIcon),
      iconName(type) { return mergedTypeToIcon[type] || "service"; },
      withIcons: createLibrary,
    };
    return Object.freeze(library);
  }

  root.ARCHITECTURE_LIBRARY = createLibrary();
})(window);
