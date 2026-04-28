import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const STATE_PATH = path.join(config.runtimeDir, "sync-state.json");

async function readState() {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

export async function getSyncState(source) {
  const state = await readState();
  return state[source] || {};
}

export async function updateSyncState(source, patch) {
  const state = await readState();
  const next = {
    ...(state[source] || {}),
    ...patch,
    updated_at: new Date().toISOString()
  };
  state[source] = next;
  await writeState(state);
  return next;
}
