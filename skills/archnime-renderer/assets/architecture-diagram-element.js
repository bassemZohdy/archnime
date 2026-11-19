/* <architecture-diagram> — plain-global, no-build-step web component.
 *
 * The element reuses the renderer source from template.html, but supplies a
 * shadow-root document facade and a per-instance window facade. This keeps
 * D3 joins, controls, keyboard listeners, token lookups, and exported helper
 * functions local to each element instead of addressing the host page.
 *
 * Required globals, loaded in this order by the host page:
 *   architecture-library.js, d3, dagre (optional), elkjs (optional),
 *   diagram-engine.js, architecture-diagram-element.js
 */
(function (global) {
  "use strict";

  const scriptBase = global.document.currentScript?.src
    ? new URL(".", global.document.currentScript.src)
    : new URL(".", global.document.baseURI);
  const templateUrl = new URL("./template.html", scriptBase);
  const observed = ["src", "stage", "mode", "perspective", "controls"];

  function modelFromInline(element) {
    const script = element.querySelector('script[type="application/json"]');
    if (!script) return null;
    return JSON.parse(script.textContent || "{}");
  }

  function scopedDocument(root, body, owner) {
    return new Proxy(owner, {
      get(target, property) {
        if (property === "body" || property === "head" || property === "documentElement") return body;
        if (property === "ownerDocument") return target;
        if (property === "getElementById") return id => root.querySelector(`#${String(id)}`);
        if (property === "querySelector") return selector => root.querySelector(selector);
        if (property === "querySelectorAll") return selector => root.querySelectorAll(selector);
        if (property === "addEventListener") return (type, listener, options) => root.addEventListener(type, listener, options);
        if (property === "removeEventListener") return (type, listener, options) => root.removeEventListener(type, listener, options);
        if (property === "title") return target.title;
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set(target, property, value) {
        // A diagram inside a page must not rename the host document.
        if (property === "title") return true;
        return Reflect.set(target, property, value, target);
      },
    });
  }

  function scopedWindow(state, scopedDoc) {
    return new Proxy(state, {
      get(target, property) {
        if (property === "document") return scopedDoc;
        if (property in target) return target[property];
        const value = global[property];
        return typeof value === "function" ? value.bind(global) : value;
      },
      set(target, property, value) {
        target[property] = value;
        return true;
      },
    });
  }

  function scopedD3(root) {
    const base = global.d3;
    if (!base) return base;
    return new Proxy(base, {
      get(target, property) {
        if (property === "select") return selector => target.select(typeof selector === "string" ? root.querySelector(selector) : selector);
        if (property === "selectAll") return selector => target.selectAll(typeof selector === "string" ? root.querySelectorAll(selector) : selector);
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  function shellFromTemplate(source) {
    const styleMatch = source.match(/<style>([\s\S]*?)<\/style>/i);
    const bodyMatch = source.match(/<body>([\s\S]*?)\s*<script>/i);
    if (!styleMatch || !bodyMatch) throw new Error("template.html is missing its style or shadow-root shell");
    // The palette lives on :root, which matches nothing inside a shadow root: move it to :host, or every
    // var(--data), var(--existing-fill)… is undefined there and nodes paint black.
    return { css: styleMatch[1].replace(/:root\b/g, ":host"), html: bodyMatch[1] };
  }

  // @font-face rules inside a shadow root are ignored by browsers, so the
  // template's embedded diagram font is registered once on the host document.
  function ensureDocumentFonts(ownerDocument, source) {
    if (ownerDocument.getElementById("architecture-diagram-fonts")) return;
    const match = source.match(/<style id="diagram-fonts">([\s\S]*?)<\/style>/i);
    if (!match) return;
    const style = ownerDocument.createElement("style");
    style.id = "architecture-diagram-fonts";
    style.textContent = match[1];
    ownerDocument.head.appendChild(style);
  }

  function rendererFromTemplate(source) {
    const marker = source.indexOf("/* DATA");
    const start = source.indexOf("(function () {", marker);
    const end = source.indexOf("</script>", start);
    if (marker < 0 || start < 0 || end < 0) throw new Error("template.html is missing its renderer script");
    return source.slice(start, end);
  }

  function setError(element, message) {
    element.shadowRoot.innerHTML = "";
    const box = element.ownerDocument.createElement("div");
    box.setAttribute("role", "alert");
    box.style.cssText = "padding:16px;border:1px solid #d2337b;border-radius:8px;color:#d2337b;font:14px system-ui,sans-serif";
    box.textContent = `Architecture diagram failed: ${message}`;
    element.shadowRoot.appendChild(box);
  }

  class ArchitectureDiagramElement extends global.HTMLElement {
    static get observedAttributes() { return observed; }

    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._renderToken = 0;
      this._runtime = null;
      this.diagramStatus = "idle";
      this.diagramError = null;
    }

    connectedCallback() { setTimeout(() => { if (this.isConnected) this.render(); }, 0); }

    disconnectedCallback() {
      ++this._renderToken;
      this._runtime?.localWindow.diagramDispose?.();
      this._runtime = null;
      this.diagramStatus = "disconnected";
    }

    attributeChangedCallback() {
      if (this.isConnected) this.render();
    }

    async loadModel() {
      const source = this.getAttribute("src");
      if (source) {
        let response;
        const modelUrl = new URL(source, this.ownerDocument.baseURI);
        try { response = await fetch(modelUrl); } catch (error) { throw new Error(`could not fetch model ${modelUrl}: ${error.message || error}`); }
        if (!response.ok) throw new Error(`could not load model (${response.status})`);
        return response.json();
      }
      const inline = modelFromInline(this);
      if (inline) return inline;
      throw new Error("provide a src attribute or an application/json child script");
    }

    async render() {
      const token = ++this._renderToken;
      this.diagramStatus = "loading";
      this.diagramError = null;
      this._runtime?.localWindow.diagramDispose?.();
      this._runtime = null;
      try {
        const model = await this.loadModel();
        let templateResponse;
        try { templateResponse = await fetch(templateUrl); } catch (error) { throw new Error(`could not fetch renderer template ${templateUrl}: ${error.message || error}`); }
        if (!templateResponse.ok) throw new Error(`could not load renderer template (${templateResponse.status})`);
        const template = await templateResponse.text();
        if (token !== this._renderToken) return;
        const { css, html } = shellFromTemplate(template);
        ensureDocumentFonts(this.ownerDocument, template);
        const body = this.ownerDocument.createElement("body");
        body.innerHTML = html;
        const style = this.ownerDocument.createElement("style");
        style.textContent = `${css}\n:host{display:block;contain:content}\nbody.element-static .controls,body.element-static .flow-timeline{display:none!important}\nbody.element-static .node,body.element-static .package-hit{pointer-events:none!important;cursor:default}\nbody.controls-none .controls,body.controls-none .flow-timeline{display:none!important}\nbody.controls-minimal .perspective-tools,body.controls-minimal .search-tools,body.controls-minimal #btn-presenter,body.controls-minimal #btn-print,body.controls-minimal #btn-export-png,body.controls-minimal #btn-export-jpeg,body.controls-minimal #btn-export-gif,body.controls-minimal .hint{display:none!important}`;
        this.shadowRoot.replaceChildren(style, body);
        const doc = scopedDocument(this.shadowRoot, body, this.ownerDocument);
        const state = Object.create(null);
        const localWindow = scopedWindow(state, doc);
        const scopedUrl = new URL(this.ownerDocument.defaultView.location.href);
        const navigationModel = model.views?.[0] || model;
        const navigationParam = navigationModel.flow ? "step" : navigationModel.meta?.composition === "scenarios" ? "variant" : "stage";
        if (this.hasAttribute("stage")) scopedUrl.searchParams.set(navigationParam, this.getAttribute("stage"));
        const mode = this.getAttribute("mode") || "interactive";
        const controls = this.getAttribute("controls") || "full";
        if (!["interactive", "static"].includes(mode)) throw new Error(`mode must be interactive or static, got ${mode}`);
        if (!["full", "minimal", "none"].includes(controls)) throw new Error(`controls must be full, minimal, or none, got ${controls}`);
        if (mode === "static") body.classList.add("element-static");
        if (controls === "none") body.classList.add("controls-none");
        if (controls === "minimal") body.classList.add("controls-minimal");
        if (!global.DiagramEngine) throw new Error("diagram-engine.js must be loaded before architecture-diagram-element.js");
        new Function("document", "MODEL", "window", "location", "history", "d3", `${rendererFromTemplate(template)}\n//# sourceURL=architecture-diagram-element-renderer.js`)(doc, model, localWindow, scopedUrl, { replaceState() {} }, scopedD3(this.shadowRoot));
        if (token !== this._renderToken || !this.isConnected) { localWindow.diagramDispose?.(); return; }
        this._runtime = { localWindow, doc, body };
        this.diagramReady = Promise.resolve(localWindow.diagramReady).then(() => {
          if (mode === "static") this.shadowRoot.querySelectorAll("[tabindex]").forEach(item => item.setAttribute("tabindex", "-1"));
          if (this.hasAttribute("perspective")) {
            const desired = this.getAttribute("perspective");
            const select = this.shadowRoot.querySelector("#perspective-select");
            if (select && [...select.options].some(option => option.value === desired)) {
              select.value = desired;
              select.dispatchEvent(new Event("change", { bubbles: true }));
            }
          }
          if (token !== this._renderToken) return;
          this.diagramStatus = "ready";
          this.dispatchEvent(new CustomEvent("architecture-diagram-ready"));
        });
        await this.diagramReady;
      } catch (error) {
        if (token !== this._renderToken) return;
        this.diagramStatus = "error";
        this.diagramError = error.message || String(error);
        setError(this, error.message || String(error));
        this.dispatchEvent(new CustomEvent("architecture-diagram-error", { detail: error }));
      }
    }

    serializeArchitectureMermaid() { return this._runtime?.localWindow.serializeArchitectureMermaid?.() || ""; }
    serializeDocumentationSvg() { return this._runtime?.localWindow.serializeDocumentationSvg?.() || ""; }
    serializeAnimatedSvg() { return this._runtime?.localWindow.serializeAnimatedSvg?.() || Promise.resolve(""); }
    diagramSelfCheck() {
      if (this.diagramStatus !== "ready") return [{ type: this.diagramStatus === "error" ? "runtime-error" : "runtime-unavailable", detail: this.diagramError || `diagram status is ${this.diagramStatus}` }];
      return this._runtime.localWindow.diagramSelfCheck?.() || [{ type: "self-check-unavailable", detail: "diagram runtime did not expose a self-check" }];
    }
  }

  if (!global.customElements.get("architecture-diagram")) global.customElements.define("architecture-diagram", ArchitectureDiagramElement);
})(window);
