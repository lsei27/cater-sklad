#!/usr/bin/env node
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";

const API_BASE_URL = (process.env.API_BASE_URL || "").replace(/\/+$/, "");
if (!API_BASE_URL) {
  console.error("Missing API_BASE_URL, e.g. https://staging-api.example.com");
  process.exit(1);
}

const EM_EMAIL = process.env.EM_EMAIL || "em@local";
const EM_PASSWORD = process.env.EM_PASSWORD || "em123";
const CHEF_EMAIL = process.env.CHEF_EMAIL || "chef@local";
const CHEF_PASSWORD = process.env.CHEF_PASSWORD || "chef123";
const WH_EMAIL = process.env.WH_EMAIL || "warehouse@local";
const WH_PASSWORD = process.env.WH_PASSWORD || "";
const EM_COUNT = Number(process.env.EM_COUNT || 3);
const CHEF_COUNT = Number(process.env.CHEF_COUNT || 2);
const DURATION_SEC = Number(process.env.DURATION_SEC || 30);

const START_AT =
  process.env.START_AT || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const END_AT =
  process.env.END_AT || new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

const metrics = {
  total: 0,
  durations: [],
  byLabel: new Map(),
  statusCounts: new Map(),
  errors: []
};

function recordMetric(label, durationMs, status, ok) {
  metrics.total += 1;
  metrics.durations.push(durationMs);
  if (!metrics.byLabel.has(label)) metrics.byLabel.set(label, []);
  metrics.byLabel.get(label).push(durationMs);
  if (status !== undefined) {
    metrics.statusCounts.set(status, (metrics.statusCounts.get(status) || 0) + 1);
  }
  if (!ok) {
    metrics.errors.push({ label, status });
  }
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

async function httpJson({ method, path, token, body, label }) {
  const url = `${API_BASE_URL}${path}`;
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;

  const started = performance.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const duration = performance.now() - started;
    recordMetric(label || `${method} ${path}`, duration, res.status, res.ok);
    if (!res.ok) {
      return { ok: false, status: res.status, data };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    const duration = performance.now() - started;
    recordMetric(label || `${method} ${path}`, duration, "network_error", false);
    return { ok: false, status: "network_error", data: { error: String(err) } };
  }
}

async function httpRaw({ method, path, token, label }) {
  const url = `${API_BASE_URL}${path}`;
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;

  const started = performance.now();
  try {
    const res = await fetch(url, { method, headers });
    try {
      await res.arrayBuffer();
    } catch {
      // Ignore body read errors for latency tracking.
    }
    const duration = performance.now() - started;
    recordMetric(label || `${method} ${path}`, duration, res.status, res.ok);
    return { ok: res.ok, status: res.status };
  } catch (err) {
    const duration = performance.now() - started;
    recordMetric(label || `${method} ${path}`, duration, "network_error", false);
    return { ok: false, status: "network_error", error: String(err) };
  }
}

async function login(email, password) {
  const res = await httpJson({
    method: "POST",
    path: "/auth/login",
    body: { email, password },
    label: "POST /auth/login"
  });
  if (!res.ok) return null;
  return res.data?.token || null;
}

async function createEvent(token, name) {
  const res = await httpJson({
    method: "POST",
    path: "/events",
    token,
    body: {
      name,
      location: "Load Test",
      delivery_datetime: START_AT,
      pickup_datetime: END_AT
    },
    label: "POST /events"
  });
  if (!res.ok) return null;
  return res.data?.event?.id || null;
}

async function getCategoriesTree(token) {
  const res = await httpJson({
    method: "GET",
    path: "/categories/tree",
    token,
    label: "GET /categories/tree"
  });
  if (!res.ok) return [];
  return res.data?.parents || [];
}

async function getInventoryItems(token, { parentCategoryId }) {
  const params = new URLSearchParams();
  params.set("with_stock", "true");
  params.set("active", "true");
  params.set("start_at", START_AT);
  params.set("end_at", END_AT);
  if (parentCategoryId) params.set("parent_category_id", parentCategoryId);

  const res = await httpJson({
    method: "GET",
    path: `/inventory/items?${params.toString()}`,
    token,
    label: "GET /inventory/items"
  });
  if (!res.ok) return [];
  const items = res.data?.items || [];
  return items.filter((i) => Number(i?.stock?.available || 0) > 0);
}

async function getAvailability(token, eventId, itemIds) {
  const res = await httpJson({
    method: "POST",
    path: `/events/${eventId}/availability`,
    token,
    body: { inventory_item_ids: itemIds },
    label: "POST /events/:id/availability"
  });
  if (!res.ok) return [];
  return res.data?.rows || [];
}

async function reserveItems(token, eventId, items) {
  const res = await httpJson({
    method: "POST",
    path: `/events/${eventId}/reserve`,
    token,
    body: { items },
    label: "POST /events/:id/reserve"
  });
  return res.ok;
}

async function confirmChef(token, eventId) {
  const res = await httpJson({
    method: "POST",
    path: `/events/${eventId}/confirm-chef`,
    token,
    body: {},
    label: "POST /events/:id/confirm-chef"
  });
  return res.ok;
}

async function exportEvent(token, eventId) {
  const res = await httpJson({
    method: "POST",
    path: `/events/${eventId}/export`,
    token,
    body: {},
    label: "POST /events/:id/export"
  });
  if (!res.ok) return null;
  return { pdfUrl: res.data?.pdfUrl || null };
}

async function downloadPdf(token, pdfPath) {
  if (!pdfPath) return false;
  const res = await httpRaw({
    method: "GET",
    path: pdfPath,
    token,
    label: "GET /events/:id/exports/:version/pdf"
  });
  return res.ok;
}

async function issueEvent(token, eventId) {
  const res = await httpJson({
    method: "POST",
    path: `/events/${eventId}/issue`,
    token,
    body: {
      idempotency_key: `issue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    },
    label: "POST /events/:id/issue"
  });
  return res.ok;
}

function pickRandom(items, count) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(count, copy.length));
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

async function seedReservation(token, eventId, items, maxQty = 1) {
  const selected = pickRandom(items, 2);
  if (!selected.length) return false;
  const itemIds = selected.map((it) => it.itemId);
  const availabilityRows = await getAvailability(token, eventId, itemIds);
  const availableById = new Map(
    availabilityRows.map((row) => [row.inventoryItemId, Number(row.available || 0)])
  );
  const reservePayload = selected
    .map((it) => {
      const available = availableById.get(it.itemId) ?? 0;
      if (available <= 0) return null;
      const qty = Math.min(available, maxQty);
      return { inventory_item_id: it.itemId, qty };
    })
    .filter(Boolean);
  if (!reservePayload.length) return false;
  await reserveItems(token, eventId, reservePayload);
  return true;
}

async function runEventManagerLoop(actor, endAtMs) {
  while (Date.now() < endAtMs) {
    const selected = pickRandom(actor.items, 2 + Math.floor(Math.random() * 2));
    if (!selected.length) {
      await delay(200);
      continue;
    }
    const itemIds = selected.map((it) => it.itemId);
    const availabilityRows = await getAvailability(actor.token, actor.eventId, itemIds);
    const availableById = new Map(
      availabilityRows.map((row) => [row.inventoryItemId, Number(row.available || 0)])
    );

    const reservePayload = selected
      .map((it) => {
        const available = availableById.get(it.itemId) ?? 0;
        if (available <= 0) return null;
        const qty = Math.min(available, Math.random() < 0.8 ? 1 : 2);
        return { inventory_item_id: it.itemId, qty };
      })
      .filter(Boolean);

    if (reservePayload.length) {
      await reserveItems(actor.token, actor.eventId, reservePayload);
      await getAvailability(actor.token, actor.eventId, itemIds);
    }

    await delay(200 + Math.floor(Math.random() * 400));
  }
}

async function runChefLoop(actor, eventIds, endAtMs) {
  let index = 0;
  while (Date.now() < endAtMs) {
    const eventId = eventIds[index % eventIds.length];
    index += 1;
    const selected = pickRandom(actor.items, 2);
    if (!selected.length) {
      await delay(200);
      continue;
    }
    const itemIds = selected.map((it) => it.itemId);
    const availabilityRows = await getAvailability(actor.token, eventId, itemIds);
    const availableById = new Map(
      availabilityRows.map((row) => [row.inventoryItemId, Number(row.available || 0)])
    );

    const reservePayload = selected
      .map((it) => {
        const available = availableById.get(it.itemId) ?? 0;
        if (available <= 0) return null;
        const qty = Math.min(available, 1);
        return { inventory_item_id: it.itemId, qty };
      })
      .filter(Boolean);

    if (reservePayload.length) {
      await reserveItems(actor.token, eventId, reservePayload);
      await getAvailability(actor.token, eventId, itemIds);
    }

    await delay(250 + Math.floor(Math.random() * 450));
  }
}

async function main() {
  console.log("Starting staging multi-user test");
  console.log(`API: ${API_BASE_URL}`);
  console.log(`Duration: ${DURATION_SEC}s, EM: ${EM_COUNT}, Chef: ${CHEF_COUNT}`);

  if (!WH_PASSWORD) {
    console.error("Missing WH_PASSWORD for warehouse user.");
    process.exit(1);
  }

  const emActors = [];
  for (let i = 0; i < EM_COUNT; i += 1) {
    const token = await login(EM_EMAIL, EM_PASSWORD);
    if (!token) {
      console.error("Event manager login failed");
      process.exit(1);
    }
    const eventId = await createEvent(token, `Load Test EM ${i + 1} ${Date.now()}`);
    if (!eventId) {
      console.error("Event creation failed");
      process.exit(1);
    }
    const items = await getInventoryItems(token, { parentCategoryId: null });
    emActors.push({ token, eventId, items });
  }

  if (!emActors.length) {
    console.error("No event managers created");
    process.exit(1);
  }

  const eventIds = emActors.map((a) => a.eventId);

  await Promise.all(
    emActors.map((actor) => seedReservation(actor.token, actor.eventId, actor.items, 2))
  );

  const chefActors = [];
  for (let i = 0; i < CHEF_COUNT; i += 1) {
    const token = await login(CHEF_EMAIL, CHEF_PASSWORD);
    if (!token) {
      console.error("Chef login failed");
      process.exit(1);
    }
    const categories = await getCategoriesTree(token);
    const kitchenParent = categories.find((c) => normalizeName(c.name).includes("kuchyn"));
    if (!kitchenParent) {
      console.error("Kitchen parent category not found");
      process.exit(1);
    }
    const items = await getInventoryItems(token, { parentCategoryId: kitchenParent.id });
    chefActors.push({ token, items });
  }

  if (!chefActors.length) {
    console.error("No chef users available");
    process.exit(1);
  }

  const warehouseToken = await login(WH_EMAIL, WH_PASSWORD);
  if (!warehouseToken) {
    console.error("Warehouse login failed");
    process.exit(1);
  }

  const endAtMs = Date.now() + DURATION_SEC * 1000;
  const finalizeWindowMs = Math.min(10000, Math.max(5000, Math.floor(DURATION_SEC * 1000 * 0.3)));
  const activeEndMs = Math.max(Date.now(), endAtMs - finalizeWindowMs);

  const loops = [
    ...emActors.map((actor) => runEventManagerLoop(actor, activeEndMs)),
    ...chefActors.map((actor) => runChefLoop(actor, eventIds, activeEndMs))
  ];

  await Promise.all(loops);

  const chefToken = chefActors[0].token;
  console.log("\nFinalizing events (chef confirm, export PDF, warehouse issue)...");

  for (const actor of emActors) {
    await seedReservation(chefToken, actor.eventId, chefActors[0].items, 1);
    await confirmChef(chefToken, actor.eventId);
    const exported = await exportEvent(actor.token, actor.eventId);
    if (exported?.pdfUrl) {
      await downloadPdf(actor.token, exported.pdfUrl);
    }
    await issueEvent(warehouseToken, actor.eventId);
  }

  const p95 = percentile(metrics.durations, 95);
  const statusSummary = Array.from(metrics.statusCounts.entries())
    .map(([status, count]) => `${status}:${count}`)
    .join(", ");

  console.log("\nResults:");
  console.log(`Total requests: ${metrics.total}`);
  console.log(`Errors: ${metrics.errors.length}`);
  console.log(`Status counts: ${statusSummary || "none"}`);
  console.log(`p95 latency: ${p95 ? `${p95.toFixed(1)}ms` : "n/a"}`);

  const labelRows = Array.from(metrics.byLabel.entries()).map(([label, values]) => ({
    label,
    count: values.length,
    p95: percentile(values, 95) || 0
  }));
  labelRows.sort((a, b) => b.count - a.count);
  console.log("\nPer-endpoint p95:");
  for (const row of labelRows) {
    console.log(`- ${row.label}: count=${row.count}, p95=${row.p95.toFixed(1)}ms`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
