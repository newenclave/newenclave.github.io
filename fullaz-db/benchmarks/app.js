"use strict";

const DATA_URL = "standard-20260830.json";
const WRITE_COUNTS = {
  bulk_load_ns: 1_000_000,
  individual_writes_ns: 1_000,
  batch_writes_ns: 100_000,
};
const WRITE_LABELS = {
  bulk_load_ns: "Bulk loading: one durable transaction with 1,000,000 keys.",
  individual_writes_ns: "One-key writes: 1,000 independent durable transactions.",
  batch_writes_ns: "Batch writes: 100 durable transactions with 1,000 keys each.",
};
const READ_COUNTS = { point: 1_000_000, range: 100_000 };
const CELL_ORDER = [
  "static.neighbor_share",
  "static.force_split",
  "static_wal.neighbor_share",
  "static_wal.force_split",
  "virtual_static_cow.neighbor_share",
  "virtual_static_cow.force_split",
  "dynamic.neighbor_share",
  "dynamic.force_split",
  "dynamic_wal.neighbor_share",
  "dynamic_wal.force_split",
  "redb.immediate",
];

let matrix = null;

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function cellClass(cellId) {
  if (cellId === "redb.immediate") {
    return "redb";
  }
  if (cellId.startsWith("virtual_static_cow")) {
    return "cow";
  }
  if (cellId.includes("_wal")) {
    return "wal";
  }
  return "";
}

function displayCell(cellId) {
  return cellId
    .replace("virtual_static_cow", "virtual static CoW")
    .replace("neighbor_share", "neighbor share")
    .replace("force_split", "force split")
    .replace("static_wal", "static WAL")
    .replace("dynamic_wal", "dynamic WAL")
    .replace("redb.immediate", "redb immediate");
}

function formatRate(value, unit) {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}G ${unit}`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M ${unit}`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K ${unit}`;
  }
  return `${Math.round(value)} ${unit}`;
}

function formatBytes(value) {
  if (value >= 1024 ** 3) {
    return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  }
  if (value >= 1024 ** 2) {
    return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  }
  return `${Math.round(value / 1024)} KiB`;
}

function valuesFor(cellId, selector) {
  return matrix.repetitions.map((repetition) => {
    let value = repetition.cells[cellId];
    for (const field of selector) {
      value = value[field];
    }
    return Number(value);
  });
}

function renderBars(container, items, formatter) {
  container.replaceChildren();
  const maximum = Math.max(...items.map((item) => item.value));
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "bar-row";

    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = displayCell(item.id);

    const track = document.createElement("div");
    track.className = "bar-track";
    const bar = document.createElement("div");
    bar.className = `bar ${cellClass(item.id)}`.trim();
    bar.style.width = `${(item.value / maximum) * 100}%`;
    track.append(bar);

    const value = document.createElement("span");
    value.className = "bar-value";
    value.textContent = formatter(item.value);

    row.append(label, track, value);
    container.append(row);
  }
}

function renderWrite(metric) {
  const count = WRITE_COUNTS[metric];
  const unit = metric === "individual_writes_ns" ? "tx/s" : "keys/s";
  const items = CELL_ORDER.map((id) => ({
    id,
    value: count * 1_000_000_000 / median(valuesFor(id, ["build", metric])),
  }));
  renderBars(document.getElementById("write-chart"), items, (value) => formatRate(value, unit));
  document.getElementById("write-caption").textContent = WRITE_LABELS[metric];
}

function renderRead(key) {
  const [, , phase] = key.split(".");
  const unit = phase === "point" ? "keys/s" : "scans/s";
  const items = CELL_ORDER.map((id) => ({
    id,
    value: READ_COUNTS[phase] * 1_000_000_000 / median(valuesFor(id, ["reads", key, "duration_ns"])),
  }));
  renderBars(document.getElementById("read-chart"), items, (value) => formatRate(value, unit));
  const [cacheBytes, cacheMode] = key.split(".");
  const cache = cacheBytes === "67108864" ? "64 MiB" : "1 GiB";
  const mode = cacheMode === "os_warm" ? "warm after a sequential pre-read" : "best-effort fadvise cold";
  document.getElementById("read-caption").textContent = `${cache} application cache, ${mode}, ${phase} reads.`;
}

function renderStorage(metric) {
  const items = CELL_ORDER.map((id) => ({
    id,
    value: median(valuesFor(id, ["storage", "total", metric])),
  }));
  renderBars(document.getElementById("storage-chart"), items, formatBytes);
  document.getElementById("storage-caption").textContent = metric === "allocated_bytes"
    ? "Allocated bytes show physical space. redb has a sparse database file, so this is the primary comparison."
    : "Logical bytes show file length. Compare this with allocated bytes to see sparse-file behavior.";
}

function activateTab(tab) {
  for (const candidate of document.querySelectorAll("[data-tab]")) {
    const selected = candidate === tab;
    candidate.setAttribute("aria-selected", String(selected));
    document.getElementById(candidate.dataset.tab).hidden = !selected;
  }
}

function moveTab(event, tab) {
  const tabs = [...document.querySelectorAll("[data-tab]")];
  const current = tabs.indexOf(tab);
  let next = null;
  if (event.key === "ArrowRight") {
    next = tabs[(current + 1) % tabs.length];
  } else if (event.key === "ArrowLeft") {
    next = tabs[(current - 1 + tabs.length) % tabs.length];
  } else if (event.key === "Home") {
    next = tabs[0];
  } else if (event.key === "End") {
    next = tabs[tabs.length - 1];
  }
  if (next) {
    event.preventDefault();
    next.focus();
    activateTab(next);
  }
}

function connectControls() {
  for (const tab of document.querySelectorAll("[data-tab]")) {
    tab.addEventListener("click", () => activateTab(tab));
    tab.addEventListener("keydown", (event) => moveTab(event, tab));
  }

  for (const button of document.querySelectorAll("[data-write]")) {
    button.addEventListener("click", () => {
      if (!matrix) {
        return;
      }
      for (const candidate of document.querySelectorAll("[data-write]")) {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      }
      renderWrite(button.dataset.write);
    });
  }

  for (const button of document.querySelectorAll("[data-read]")) {
    button.addEventListener("click", () => {
      if (!matrix) {
        return;
      }
      for (const candidate of document.querySelectorAll("[data-read]")) {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      }
      renderRead(button.dataset.read);
    });
  }

  for (const button of document.querySelectorAll("[data-storage]")) {
    button.addEventListener("click", () => {
      if (!matrix) {
        return;
      }
      for (const candidate of document.querySelectorAll("[data-storage]")) {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      }
      renderStorage(button.dataset.storage);
    });
  }

  const rail = document.getElementById("strategy-rail");
  const scrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  function scrollRail(distance) {
    rail.scrollBy({ left: distance, behavior: scrollBehavior });
  }
  for (const button of document.querySelectorAll("[data-rail]")) {
    button.addEventListener("click", () => {
      const distance = rail.clientWidth * 0.8;
      scrollRail(button.dataset.rail === "next" ? distance : -distance);
    });
  }
  rail.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      scrollRail((event.key === "ArrowRight" ? 1 : -1) * rail.clientWidth * 0.8);
    }
  });
}

async function start() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) {
      throw new Error(`request failed with ${response.status}`);
    }
    matrix = await response.json();
    if (matrix.repetitions?.length !== 5) {
      throw new Error("expected five benchmark repetitions");
    }
    renderWrite("bulk_load_ns");
    renderRead("67108864.os_warm.point");
    renderStorage("allocated_bytes");
  } catch (error) {
    const message = document.createElement("span");
    message.className = "status error";
    message.textContent = `Could not load result data: ${error.message}`;
    for (const chart of document.querySelectorAll(".bar-list")) {
      chart.replaceChildren(message.cloneNode(true));
    }
  }
}

connectControls();
start();
