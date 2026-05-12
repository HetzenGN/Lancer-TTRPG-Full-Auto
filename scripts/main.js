// scripts/main.js

import { registerAutomations, makeActionApi } from "./automations.js";

const MODULE_ID = "lancer-ttrpg-full-auto";
const SOCKET = `module.${MODULE_ID}`;

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready`);

  game.socket.on(SOCKET, handleSocketMessage);

  const statusApi = {
    applyStatusByPlayer,
    removeStatusByPlayer,
    toggleStatusByPlayer
  };

  const actionApi = makeActionApi(statusApi);

  const api = {
    ...statusApi,
    ...actionApi
  };

  game.modules.get(MODULE_ID).api = api;

  registerAutomations(api);
});

async function applyStatusByPlayer(statusId, tokens) {
  return requestStatusChange("apply", statusId, tokens);
}

async function removeStatusByPlayer(statusId, tokens) {
  return requestStatusChange("remove", statusId, tokens);
}

async function toggleStatusByPlayer(statusId, tokens) {
  return requestStatusChange("toggle", statusId, tokens);
}

async function requestStatusChange(mode, statusId, tokens) {
  const tokenUuids = Array.from(tokens ?? [])
    .map(t => t?.document?.uuid)
    .filter(Boolean);

  if (!tokenUuids.length) {
    ui.notifications.warn("No valid target tokens.");
    return;
  }

  const payload = {
    type: "status-change",
    mode,
    statusId,
    tokenUuids,
    userId: game.user.id
  };

  if (game.user.isGM) {
    return handleSocketMessage(payload);
  }

  game.socket.emit(SOCKET, payload);
}

async function handleSocketMessage(payload) {
  if (!game.user.isGM) return;
  if (payload?.type !== "status-change") return;

  for (const uuid of payload.tokenUuids ?? []) {
    const tokenDoc = await fromUuid(uuid);
    const actor = tokenDoc?.actor;

    if (!actor) continue;

    await setActorStatus(actor, payload.statusId, payload.mode);
  }
}

async function setActorStatus(actor, statusId, mode) {
  const hasStatus = actor.statuses?.has(statusId) ?? false;

  if (mode === "apply" && hasStatus) return;
  if (mode === "remove" && !hasStatus) return;

  if (typeof actor.toggleStatusEffect === "function") {
    const active =
      mode === "apply" ? true :
      mode === "remove" ? false :
      !hasStatus;

    return actor.toggleStatusEffect(statusId, { active });
  }

  ui.notifications.error(
    `Could not change status ${statusId}; actor status API unavailable.`
  );
}