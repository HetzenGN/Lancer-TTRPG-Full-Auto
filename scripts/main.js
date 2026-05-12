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
    toggleStatusByPlayer,
	applyTimedStatusByPlayer,
	applyHeatByPlayer
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

async function requestStatusChange(mode, statusId, tokens, options = {}) {
  const tokenUuids = Array.from(tokens ?? [])
    .map(t => t?.document?.uuid)
    .filter(Boolean);

  if (!tokenUuids.length) {
    ui.notifications.warn("No valid target tokens.");
    return;
  }

async function applyTimedStatusByPlayer(statusId, tokens, duration = { turns: 1 }) {
  return requestStatusChange("apply", statusId, tokens, { duration });
}

async function applyHeatByPlayer(amount, tokens) {
  return requestHeatChange(amount, tokens);
}

  const payload = {
    type: "status-change",
    mode,
    statusId,
    tokenUuids,
    duration: options.duration ?? null,
    userId: game.user.id
  };

  if (game.user.isGM) {
    return handleSocketMessage(payload);
  }

  game.socket.emit(SOCKET, payload);
}

async function requestHeatChange(amount, tokens) {
  const tokenUuids = Array.from(tokens ?? [])
    .map(t => t?.document?.uuid)
    .filter(Boolean);

  if (!tokenUuids.length) {
    ui.notifications.warn("No valid target tokens.");
    return;
  }

  const payload = {
    type: "heat-change",
    amount,
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

  if (payload?.type === "status-change") {
    for (const uuid of payload.tokenUuids ?? []) {
      const tokenDoc = await fromUuid(uuid);
      const actor = tokenDoc?.actor;

      if (!actor) continue;

      await setActorStatus(
        actor,
        payload.statusId,
        payload.mode,
        { duration: payload.duration ?? null }
      );
    }

    return;
  }

  if (payload?.type === "heat-change") {
    for (const uuid of payload.tokenUuids ?? []) {
      const tokenDoc = await fromUuid(uuid);
      const actor = tokenDoc?.actor;

      if (!actor) continue;

      await applyHeatToActor(actor, payload.amount);
    }

    return;
  }
}

async function setActorStatus(actor, statusId, mode, options = {}) {
  const duration = options.duration ?? null;
  const hasStatus = actor.statuses?.has(statusId) ?? false;

  // Apply-only permanent status.
  if (mode === "apply" && !duration && hasStatus) return;

  // Remove-only status.
  if (mode === "remove" && !hasStatus) return;

  // Timed apply: create or refresh a module-owned temporary status effect.
  if (mode === "apply" && duration) {
    return applyTimedStatusToActor(actor, statusId, duration);
  }

  // Normal Foundry/Lancer status toggle path.
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

async function applyTimedStatusToActor(actor, statusId, durationSpec) {
  const existingModuleEffect = actor.effects.find(effect => {
    return (
      effect.flags?.[MODULE_ID]?.temporaryStatus === true &&
      effect.flags?.[MODULE_ID]?.statusId === statusId
    );
  });

  const duration = buildEffectDuration(durationSpec);

  // If this module already applied a timed copy of this status, refresh it.
  if (existingModuleEffect) {
    return existingModuleEffect.update({ duration });
  }

  // If some other source already has this status on the actor, do not overwrite
  // it with a shorter temporary duration.
  if (actor.statuses?.has(statusId)) {
    return;
  }

  const status = CONFIG.statusEffects.find(s => s.id === statusId);

  if (!status) {
    ui.notifications.error(`Could not find status effect '${statusId}'.`);
    return;
  }

  const img = status.img ?? status.icon;
  const localizedName = game.i18n.localize(status.name ?? status.label ?? statusId);

  const effectData = {
    name: localizedName,
    img,
    icon: img,
    statuses: [statusId],
    changes: foundry.utils.deepClone(status.changes ?? []),
    duration,
    flags: {
      [MODULE_ID]: {
        temporaryStatus: true,
        statusId
      }
    }
  };

  return actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
}

function buildEffectDuration(durationSpec = {}) {
  const turns = durationSpec.turns ?? null;
  const rounds = durationSpec.rounds ?? null;
  const seconds = durationSpec.seconds ?? null;

  if (game.combat?.started) {
    const duration = {
      combat: game.combat.id,
      startRound: game.combat.round,
      startTurn: game.combat.turn
    };

    if (turns !== null) duration.turns = turns;
    if (rounds !== null) duration.rounds = rounds;

    return duration;
  }

  return {
    seconds: seconds ?? 6,
    startTime: game.time.worldTime
  };
}

async function applyHeatToActor(actor, amount) {
  const heatAmount = Number(amount) || 0;

  if (!heatAmount) return;

  // Preferred Lancer path.
  // This lets the system handle Heat normally, including entities without Heat Cap.
  if (typeof actor.damageCalc === "function") {
    return actor.damageCalc({
      Kinetic: 0,
      Energy: 0,
      Explosive: 0,
      Variable: 0,
      Burn: 0,
      Heat: heatAmount
    });
  }

  // Fallback path if damageCalc is unavailable.
  if (actor.system?.heat) {
    const current = Number(actor.system.heat.value) || 0;
    return actor.update({
      "system.heat.value": current + heatAmount
    });
  }

  ui.notifications.warn(`${actor.name} does not appear to have a heat track.`);
}