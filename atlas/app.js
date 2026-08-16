(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const els = {
    sidebar: $("sidebar"),
    sidebarScrim: $("sidebar-scrim"),
    mobileToggle: $("mobile-toggle"),
    canvas: $("network-canvas"),
    wrap: $("network-wrap"),
    tooltip: $("tooltip"),
    loading: $("loading"),
    loadingText: $("loading-text"),
    errorBox: $("error-box"),
    networkSummary: $("network-summary"),
    networkSelect: $("network-select"),
    networkCode: $("network-code"),
    networkDescription: $("network-description"),
    nodeShare: $("node-share"),
    nodeShareValue: $("node-share-value"),
    edgeWeight: $("edge-weight"),
    edgeWeightValue: $("edge-weight-value"),
    edgeWeightMax: $("edge-weight-max"),
    filterSummary: $("filter-summary"),
    nodeSize: $("node-size"),
    showLabels: $("show-labels"),
    showArrows: $("show-arrows"),
    fitButton: $("fit-button"),
    clearButton: $("clear-button"),
    selectedLabel: $("selected-label"),
    statNodes: $("stat-nodes"),
    statEdges: $("stat-edges"),
    statInteractions: $("stat-interactions"),
    statCommunities: $("stat-communities"),
    zoomIn: $("zoom-in"),
    zoomOut: $("zoom-out"),
    zoomFit: $("zoom-fit"),
  };

  const ctx = els.canvas.getContext("2d", { alpha: true, desynchronized: true });
  const fmt = new Intl.NumberFormat("en-GB");
  const PALETTE = [
    "#15aebc", "#ed8a72", "#e0ba3c", "#5ca16c", "#c46caf",
    "#668fc0", "#8fbe58", "#bc8058", "#8b75bf", "#2e967f",
    "#df6c99", "#8f9aa6", "#c3cf4f", "#4e829f", "#e59c52",
    "#71b7aa", "#a9785f", "#9d79a9", "#659fbe", "#d37668",
  ];

  const state = {
    manifest: null,
    key: null,
    data: null,
    meta: null,
    metric: "weighted",
    nodeShare: 100,
    edgeWeight: 1,
    showLabels: false,
    showArrows: false,
    maxWeight: 1,
    filterRank: [],
    visibleFlags: new Uint8Array(0),
    visibleNodes: [],
    visibleEdges: [],
    visibleInteractions: 0,
    visibleCommunities: 0,
    nodeOrder: [],
    labelNodes: [],
    selected: null,
    hovered: null,
    focusNodes: null,
    focusEdges: null,
    cssWidth: 0,
    cssHeight: 0,
    dpr: 1,
    view: { scale: 1, offsetX: 0, offsetY: 0, fitScale: 1 },
    dragging: false,
    pointerId: null,
    dragStart: null,
    dragLast: null,
    moved: false,
    framePending: false,
    loadToken: 0,
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function colour(community, alpha = 1) {
    const hex = PALETTE[Math.abs(Number(community) || 0) % PALETTE.length];
    const value = Number.parseInt(hex.slice(1), 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function setError(message) {
    if (!message) {
      els.errorBox.style.display = "none";
      els.errorBox.textContent = "";
      return;
    }
    els.errorBox.textContent = message;
    els.errorBox.style.display = "block";
  }

  function setLoading(show, text = "Loading network…") {
    els.loadingText.textContent = text;
    els.loading.classList.toggle("hidden", !show);
  }

  function metricValue(node) {
    switch (state.metric) {
      case "degree": return Number(node.size_degree) || 0;
      case "pagerank": return Number(node.size_pagerank) || 0;
      case "uniform": return 0.25;
      default: return Number(node.size_weighted) || 0;
    }
  }

  function nodeRadius(node) {
    const value = clamp(metricValue(node), 0, 1);
    const networkScale = state.data
      ? clamp(Math.pow(900 / Math.max(1, state.data.nodes.length), 0.18), 0.76, 1.42)
      : 1;
    const zoomScale = clamp(Math.pow(state.view.scale / Math.max(1e-9, state.view.fitScale), 0.16), 0.78, 1.8);
    return (1.35 + Math.pow(value, 1.28) * 9.1) * networkScale * zoomScale;
  }

  function resizeCanvas({ refit = false } = {}) {
    const rect = els.wrap.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    const changed = width !== state.cssWidth || height !== state.cssHeight || dpr !== state.dpr;
    if (!changed) return;

    state.cssWidth = width;
    state.cssHeight = height;
    state.dpr = dpr;
    els.canvas.width = Math.round(width * dpr);
    els.canvas.height = Math.round(height * dpr);
    els.canvas.style.width = `${width}px`;
    els.canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (state.data && refit) fitGraph();
    scheduleDraw();
  }

  function graphBounds() {
    if (!state.data || state.visibleNodes.length === 0) {
      return { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 };
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const index of state.visibleNodes) {
      const node = state.data.nodes[index];
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y);
    }
    return { minX, maxX, minY, maxY };
  }

  function fitGraph() {
    if (!state.data || !state.cssWidth || !state.cssHeight) return;
    const bounds = graphBounds();
    const spanX = Math.max(1e-6, bounds.maxX - bounds.minX);
    const spanY = Math.max(1e-6, bounds.maxY - bounds.minY);
    const padding = clamp(Math.min(state.cssWidth, state.cssHeight) * 0.075, 42, 86);
    const scale = Math.min(
      Math.max(80, state.cssWidth - padding * 2) / spanX,
      Math.max(80, state.cssHeight - padding * 2) / spanY,
    );
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    state.view.scale = scale;
    state.view.fitScale = scale;
    state.view.offsetX = state.cssWidth / 2 - centerX * scale;
    state.view.offsetY = state.cssHeight / 2 - centerY * scale;
    scheduleDraw();
  }

  function worldToScreen(node) {
    return {
      x: node.x * state.view.scale + state.view.offsetX,
      y: node.y * state.view.scale + state.view.offsetY,
    };
  }

  function screenToWorld(x, y) {
    return {
      x: (x - state.view.offsetX) / state.view.scale,
      y: (y - state.view.offsetY) / state.view.scale,
    };
  }

  function zoomAt(x, y, factor) {
    if (!state.data) return;
    const world = screenToWorld(x, y);
    const minScale = state.view.fitScale * 0.25;
    const maxScale = state.view.fitScale * 25;
    const nextScale = clamp(state.view.scale * factor, minScale, maxScale);
    state.view.scale = nextScale;
    state.view.offsetX = x - world.x * nextScale;
    state.view.offsetY = y - world.y * nextScale;
    scheduleDraw();
  }

  function scheduleDraw() {
    if (state.framePending) return;
    state.framePending = true;
    window.requestAnimationFrame(() => {
      state.framePending = false;
      draw();
    });
  }

  function rebuildDisplayOrder() {
    if (!state.data) return;
    state.nodeOrder = [...state.visibleNodes].sort(
      (a, b) => metricValue(state.data.nodes[a]) - metricValue(state.data.nodes[b]),
    );
    state.labelNodes = [...state.visibleNodes]
      .sort((a, b) => metricValue(state.data.nodes[b]) - metricValue(state.data.nodes[a]))
      .slice(0, Math.min(12, state.visibleNodes.length));
  }

  function applyFilters() {
    if (!state.data) return;
    const nodes = state.data.nodes;
    const keepCount = clamp(Math.round(nodes.length * state.nodeShare / 100), 1, nodes.length);
    const visibleFlags = new Uint8Array(nodes.length);
    const visibleNodes = state.filterRank.slice(0, keepCount);
    for (const index of visibleNodes) visibleFlags[index] = 1;

    const visibleEdges = [];
    let interactions = 0;
    for (let index = 0; index < state.data.edges.length; index += 1) {
      const edge = state.data.edges[index];
      if (edge.weight < state.edgeWeight) continue;
      if (!visibleFlags[edge.source] || !visibleFlags[edge.target]) continue;
      visibleEdges.push(index);
      interactions += edge.weight;
    }

    const communities = new Set();
    for (const index of visibleNodes) communities.add(nodes[index].community);

    state.visibleFlags = visibleFlags;
    state.visibleNodes = visibleNodes;
    state.visibleEdges = visibleEdges;
    state.visibleInteractions = interactions;
    state.visibleCommunities = communities.size;

    if (state.selected !== null && !state.visibleFlags[state.selected]) {
      state.selected = null;
      state.focusNodes = null;
      state.focusEdges = null;
    } else if (state.selected !== null) {
      rebuildFocus();
    }

    rebuildDisplayOrder();
    updateInterface();
    scheduleDraw();
  }

  function rebuildFocus() {
    if (state.selected === null || !state.data) {
      state.focusNodes = null;
      state.focusEdges = null;
      return;
    }
    const nodes = new Set([state.selected]);
    const edges = new Set();
    for (const edgeIndex of state.visibleEdges) {
      const edge = state.data.edges[edgeIndex];
      if (edge.source === state.selected || edge.target === state.selected) {
        edges.add(edgeIndex);
        nodes.add(edge.source);
        nodes.add(edge.target);
      }
    }
    state.focusNodes = nodes;
    state.focusEdges = edges;
  }

  function selectNode(index) {
    state.selected = index;
    rebuildFocus();
    updateInterface();
    scheduleDraw();
  }

  function quadraticPoint(p0, cp, p1, t) {
    const mt = 1 - t;
    return {
      x: mt * mt * p0.x + 2 * mt * t * cp.x + t * t * p1.x,
      y: mt * mt * p0.y + 2 * mt * t * cp.y + t * t * p1.y,
    };
  }

  function quadraticTangent(p0, cp, p1, t) {
    return {
      x: 2 * (1 - t) * (cp.x - p0.x) + 2 * t * (p1.x - cp.x),
      y: 2 * (1 - t) * (cp.y - p0.y) + 2 * t * (p1.y - cp.y),
    };
  }

  function edgeControlPoint(edge, p0, p1) {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2;
    let sign;
    if (edge.reciprocal) {
      sign = edge.source < edge.target ? 1 : -1;
    } else {
      const hash = ((edge.source + 1) * 73856093) ^ ((edge.target + 1) * 19349663);
      sign = (hash & 1) === 0 ? 1 : -1;
    }
    const offset = sign * clamp(distance * 0.07, 3.5, 27);
    return {
      x: midX - (dy / distance) * offset,
      y: midY + (dx / distance) * offset,
    };
  }

  function drawArrow(point, tangent, size, fillStyle) {
    const length = Math.max(1e-6, Math.hypot(tangent.x, tangent.y));
    const ux = tangent.x / length;
    const uy = tangent.y / length;
    const px = -uy;
    const py = ux;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    ctx.lineTo(point.x - ux * size + px * size * 0.48, point.y - uy * size + py * size * 0.48);
    ctx.lineTo(point.x - ux * size - px * size * 0.48, point.y - uy * size - py * size * 0.48);
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  function drawSelfLoop(edgeIndex, edge, isFocused) {
    const node = state.data.nodes[edge.source];
    const point = worldToScreen(node);
    const radius = nodeRadius(node);
    const loopRadius = radius + 6 + Math.log1p(edge.weight) * 1.4;
    const dimmed = state.selected !== null && !isFocused;
    const alpha = isFocused ? 0.76 : (dimmed ? 0.012 : 0.20);
    const stroke = colour(node.community, alpha);
    ctx.beginPath();
    ctx.arc(point.x + loopRadius * 0.72, point.y - loopRadius * 0.72, loopRadius, 0.18, Math.PI * 1.86);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = (isFocused ? 1.2 : 0.45) + Math.log1p(edge.weight) * 0.34;
    ctx.stroke();
    if (state.showArrows && (!dimmed || isFocused)) {
      const angle = Math.PI * 1.75;
      const arrowPoint = {
        x: point.x + loopRadius * 0.72 + Math.cos(angle) * loopRadius,
        y: point.y - loopRadius * 0.72 + Math.sin(angle) * loopRadius,
      };
      drawArrow(arrowPoint, { x: -Math.sin(angle), y: Math.cos(angle) }, 4.3, stroke);
    }
  }

  function draw() {
    if (!state.data) return;
    ctx.clearRect(0, 0, state.cssWidth, state.cssHeight);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const nodes = state.data.nodes;
    const edges = state.data.edges;

    for (let position = state.visibleEdges.length - 1; position >= 0; position -= 1) {
      const edgeIndex = state.visibleEdges[position];
      const edge = edges[edgeIndex];
      const isFocused = state.focusEdges ? state.focusEdges.has(edgeIndex) : false;
      if (edge.source === edge.target) {
        drawSelfLoop(edgeIndex, edge, isFocused);
        continue;
      }

      const source = nodes[edge.source];
      const target = nodes[edge.target];
      const p0 = worldToScreen(source);
      const p1 = worldToScreen(target);
      if ((p0.x < -60 && p1.x < -60) || (p0.y < -60 && p1.y < -60) ||
          (p0.x > state.cssWidth + 60 && p1.x > state.cssWidth + 60) ||
          (p0.y > state.cssHeight + 60 && p1.y > state.cssHeight + 60)) {
        continue;
      }

      const dimmed = state.selected !== null && !isFocused;
      const alpha = isFocused ? 0.72 : (dimmed ? 0.010 : clamp(0.07 + Math.log1p(edge.weight) * 0.032, 0.07, 0.23));
      const stroke = colour(source.community, alpha);
      const width = (isFocused ? 1.15 : 0.30) + Math.log1p(edge.weight) * (isFocused ? 0.56 : 0.28);
      const cp = edgeControlPoint(edge, p0, p1);

      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(cp.x, cp.y, p1.x, p1.y);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.stroke();

      if (state.showArrows && (!dimmed || isFocused)) {
        const t = 0.82;
        const arrowPoint = quadraticPoint(p0, cp, p1, t);
        const tangent = quadraticTangent(p0, cp, p1, t);
        drawArrow(arrowPoint, tangent, 3.0 + Math.log1p(edge.weight) * 0.65, stroke);
      }
    }

    for (const index of state.nodeOrder) {
      const node = nodes[index];
      const point = worldToScreen(node);
      const radius = nodeRadius(node);
      if (point.x < -radius - 10 || point.y < -radius - 10 ||
          point.x > state.cssWidth + radius + 10 || point.y > state.cssHeight + radius + 10) {
        continue;
      }
      const dimmed = state.focusNodes && !state.focusNodes.has(index);
      const alpha = dimmed ? 0.10 : 0.94;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = colour(node.community, alpha);
      ctx.fill();
      ctx.lineWidth = Math.max(0.45, Math.min(1.1, radius * 0.11));
      ctx.strokeStyle = dimmed ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.84)";
      ctx.stroke();

      if (index === state.selected || index === state.hovered) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius + (index === state.selected ? 3.0 : 2.0), 0, Math.PI * 2);
        ctx.lineWidth = index === state.selected ? 2.0 : 1.3;
        ctx.strokeStyle = index === state.selected ? "rgba(23,33,43,0.86)" : "rgba(23,33,43,0.55)";
        ctx.stroke();
      }
    }

    if (state.showLabels) drawLabels();
  }

  function drawLabels() {
    const zoomRatio = state.view.scale / Math.max(1e-9, state.view.fitScale);
    const fontSize = clamp(10.5 + Math.log2(Math.max(1, zoomRatio)) * 0.8, 10.5, 14);
    ctx.font = `650 ${fontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    for (const index of state.labelNodes) {
      if (state.focusNodes && !state.focusNodes.has(index)) continue;
      const node = state.data.nodes[index];
      const point = worldToScreen(node);
      const radius = nodeRadius(node);
      const x = point.x + radius + 4;
      const y = point.y;
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = "rgba(255,255,255,0.96)";
      ctx.strokeText(node.id, x, y);
      ctx.fillStyle = "rgba(52,64,84,0.92)";
      ctx.fillText(node.id, x, y);
    }
  }

  function eventPoint(event) {
    const rect = els.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function findNodeAt(x, y) {
    if (!state.data) return null;
    for (let position = state.nodeOrder.length - 1; position >= 0; position -= 1) {
      const index = state.nodeOrder[position];
      const node = state.data.nodes[index];
      const point = worldToScreen(node);
      const radius = Math.max(4.5, nodeRadius(node) + 2.5);
      const dx = x - point.x;
      const dy = y - point.y;
      if (dx * dx + dy * dy <= radius * radius) return index;
    }
    return null;
  }

  function showTooltip(index, point) {
    if (index === null || !state.data) {
      els.tooltip.style.display = "none";
      return;
    }
    const node = state.data.nodes[index];
    els.tooltip.innerHTML = `
      <div class="tooltip-title">${node.id}</div>
      <div class="tooltip-grid">
        <span>Community</span><span>${fmt.format(Number(node.community) + 1)}</span>
        <span>Connections</span><span>${fmt.format(node.degree)}</span>
        <span>Interactions</span><span>${fmt.format(node.weighted_degree)}</span>
      </div>`;
    els.tooltip.style.display = "block";

    const margin = 12;
    const width = els.tooltip.offsetWidth;
    const height = els.tooltip.offsetHeight;
    let left = point.x + 15;
    let top = point.y + 15;
    if (left + width + margin > state.cssWidth) left = point.x - width - 15;
    if (top + height + margin > state.cssHeight) top = point.y - height - 15;
    els.tooltip.style.left = `${Math.max(margin, left)}px`;
    els.tooltip.style.top = `${Math.max(margin, top)}px`;
  }

  function updateInterface() {
    if (!state.data || !state.meta) return;
    els.networkCode.textContent = state.meta.paper_label;
    els.networkDescription.textContent = state.meta.description;
    els.nodeShareValue.textContent = `${state.nodeShare}%`;
    els.edgeWeightValue.textContent = fmt.format(state.edgeWeight);
    els.filterSummary.textContent = state.nodeShare === 100 ? "All nodes" : `Top ${state.nodeShare}%`;
    els.selectedLabel.textContent = state.selected === null ? "No focus" : state.data.nodes[state.selected].id;
    els.statNodes.textContent = fmt.format(state.visibleNodes.length);
    els.statEdges.textContent = fmt.format(state.visibleEdges.length);
    els.statInteractions.textContent = fmt.format(state.visibleInteractions);
    els.statCommunities.textContent = fmt.format(state.visibleCommunities);

    if (state.selected === null) {
      els.networkSummary.textContent = `${state.meta.paper_label}: ${state.meta.title} · ${fmt.format(state.visibleNodes.length)} nodes · ${fmt.format(state.visibleEdges.length)} directed edges`;
    } else {
      const node = state.data.nodes[state.selected];
      const neighbours = Math.max(0, (state.focusNodes ? state.focusNodes.size : 1) - 1);
      els.networkSummary.textContent = `${node.id} · ${fmt.format(neighbours)} direct neighbours · ${fmt.format(node.weighted_degree)} interactions`;
    }
  }

  function populateNetworkSelect() {
    els.networkSelect.innerHTML = "";
    for (const network of state.manifest.networks) {
      const option = document.createElement("option");
      option.value = network.key;
      const actor = network.key === "government" ? "Government" : network.key === "cso" ? "CSO" : "Expert";
      option.textContent = `${network.paper_label} · ${actor}`;
      els.networkSelect.appendChild(option);
    }
  }

  async function loadNetwork(key, { updateHash = true } = {}) {
    if (!state.manifest) return;
    const available = new Set(state.manifest.networks.map((network) => network.key));
    if (!available.has(key)) key = state.manifest.networks[0].key;
    const token = ++state.loadToken;
    setError("");
    setLoading(true, `Loading ${key} network…`);
    els.tooltip.style.display = "none";

    try {
      const response = await fetch(`./data/${encodeURIComponent(key)}.json`, { cache: "force-cache" });
      if (!response.ok) throw new Error(`Network data request failed (${response.status}).`);
      const payload = await response.json();
      if (token !== state.loadToken) return;
      if (!payload || !payload.meta || !Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) {
        throw new Error("The network data file is incomplete.");
      }

      state.key = key;
      state.data = payload;
      state.meta = payload.meta;
      state.selected = null;
      state.hovered = null;
      state.focusNodes = null;
      state.focusEdges = null;
      state.edgeWeight = 1;
      state.maxWeight = payload.edges.reduce((maximum, edge) => Math.max(maximum, Number(edge.weight) || 1), 1);
      state.filterRank = payload.nodes
        .map((_, index) => index)
        .sort((a, b) => {
          const degreeDifference = payload.nodes[b].weighted_degree - payload.nodes[a].weighted_degree;
          return degreeDifference || payload.nodes[b].degree - payload.nodes[a].degree || a - b;
        });

      els.networkSelect.value = key;
      els.edgeWeight.min = "1";
      els.edgeWeight.max = String(state.maxWeight);
      els.edgeWeight.value = "1";
      els.edgeWeightMax.textContent = `max ${fmt.format(state.maxWeight)}`;
      applyFilters();
      resizeCanvas();
      fitGraph();
      setLoading(false);

      if (updateHash && window.location.hash.slice(1) !== key) {
        history.replaceState(null, "", `#${key}`);
      }
    } catch (error) {
      console.error(error);
      if (token !== state.loadToken) return;
      setLoading(false);
      setError(`The network could not be loaded.\n${error.message}`);
      els.networkSummary.textContent = "Network data could not be loaded.";
    }
  }

  async function initialise() {
    setLoading(true, "Loading network metadata…");
    try {
      const response = await fetch("./data/manifest.json", { cache: "force-cache" });
      if (!response.ok) throw new Error(`Manifest request failed (${response.status}).`);
      state.manifest = await response.json();
      populateNetworkSelect();
      const requested = window.location.hash.slice(1);
      const available = new Set(state.manifest.networks.map((network) => network.key));
      const initial = available.has(requested) ? requested : state.manifest.networks[0].key;
      await loadNetwork(initial, { updateHash: true });
    } catch (error) {
      console.error(error);
      setLoading(false);
      setError(`The atlas could not start.\n${error.message}`);
      els.networkSummary.textContent = "Atlas metadata could not be loaded.";
    }
  }

  els.networkSelect.addEventListener("change", () => {
    loadNetwork(els.networkSelect.value, { updateHash: true });
  });

  els.nodeShare.addEventListener("input", () => {
    state.nodeShare = Number(els.nodeShare.value);
    applyFilters();
  });
  els.nodeShare.addEventListener("change", fitGraph);

  els.edgeWeight.addEventListener("input", () => {
    state.edgeWeight = Number(els.edgeWeight.value);
    applyFilters();
  });

  els.nodeSize.addEventListener("change", () => {
    state.metric = els.nodeSize.value;
    rebuildDisplayOrder();
    scheduleDraw();
  });

  els.showLabels.addEventListener("change", () => {
    state.showLabels = els.showLabels.checked;
    scheduleDraw();
  });

  els.showArrows.addEventListener("change", () => {
    state.showArrows = els.showArrows.checked;
    scheduleDraw();
  });

  els.fitButton.addEventListener("click", fitGraph);
  els.zoomFit.addEventListener("click", fitGraph);
  els.clearButton.addEventListener("click", () => selectNode(null));
  els.zoomIn.addEventListener("click", () => zoomAt(state.cssWidth / 2, state.cssHeight / 2, 1.35));
  els.zoomOut.addEventListener("click", () => zoomAt(state.cssWidth / 2, state.cssHeight / 2, 1 / 1.35));

  els.canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    els.canvas.setPointerCapture(event.pointerId);
    const point = eventPoint(event);
    state.dragging = true;
    state.pointerId = event.pointerId;
    state.dragStart = point;
    state.dragLast = point;
    state.moved = false;
    els.canvas.classList.add("dragging");
    els.tooltip.style.display = "none";
  });

  els.canvas.addEventListener("pointermove", (event) => {
    const point = eventPoint(event);
    if (state.dragging && event.pointerId === state.pointerId) {
      const dx = point.x - state.dragLast.x;
      const dy = point.y - state.dragLast.y;
      if (Math.abs(point.x - state.dragStart.x) + Math.abs(point.y - state.dragStart.y) > 4) state.moved = true;
      state.view.offsetX += dx;
      state.view.offsetY += dy;
      state.dragLast = point;
      scheduleDraw();
      return;
    }

    const found = findNodeAt(point.x, point.y);
    if (found !== state.hovered) {
      state.hovered = found;
      els.canvas.classList.toggle("node-hover", found !== null);
      scheduleDraw();
    }
    showTooltip(found, point);
  });

  function finishPointer(event) {
    if (!state.dragging || event.pointerId !== state.pointerId) return;
    const point = eventPoint(event);
    if (!state.moved) {
      const found = findNodeAt(point.x, point.y);
      if (found === null || found === state.selected) selectNode(null);
      else selectNode(found);
    }
    state.dragging = false;
    state.pointerId = null;
    els.canvas.classList.remove("dragging");
    if (els.canvas.hasPointerCapture(event.pointerId)) els.canvas.releasePointerCapture(event.pointerId);
  }

  els.canvas.addEventListener("pointerup", finishPointer);
  els.canvas.addEventListener("pointercancel", finishPointer);
  els.canvas.addEventListener("pointerleave", () => {
    if (!state.dragging) {
      state.hovered = null;
      els.tooltip.style.display = "none";
      els.canvas.classList.remove("node-hover");
      scheduleDraw();
    }
  });

  els.canvas.addEventListener("dblclick", (event) => {
    const point = eventPoint(event);
    const found = findNodeAt(point.x, point.y);
    if (found === null) return;
    const node = state.data.nodes[found];
    const targetScale = clamp(state.view.fitScale * 3.2, state.view.fitScale, state.view.fitScale * 25);
    state.view.scale = targetScale;
    state.view.offsetX = state.cssWidth / 2 - node.x * targetScale;
    state.view.offsetY = state.cssHeight / 2 - node.y * targetScale;
    selectNode(found);
  });

  els.canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const point = eventPoint(event);
    zoomAt(point.x, point.y, Math.exp(-event.deltaY * 0.00135));
  }, { passive: false });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") selectNode(null);
    if ((event.key === "0" || event.key === "Home") && !event.ctrlKey && !event.metaKey && !event.altKey) fitGraph();
  });

  els.mobileToggle.addEventListener("click", () => {
    els.sidebar.classList.toggle("open");
    els.sidebarScrim.classList.toggle("visible", els.sidebar.classList.contains("open"));
  });
  els.sidebarScrim.addEventListener("click", () => {
    els.sidebar.classList.remove("open");
    els.sidebarScrim.classList.remove("visible");
  });

  window.addEventListener("hashchange", () => {
    if (!state.manifest) return;
    const key = window.location.hash.slice(1);
    if (key && key !== state.key && state.manifest.networks.some((network) => network.key === key)) {
      loadNetwork(key, { updateHash: false });
    }
  });

  const resizeObserver = new ResizeObserver(() => resizeCanvas({ refit: true }));
  resizeObserver.observe(els.wrap);

  initialise();
})();
