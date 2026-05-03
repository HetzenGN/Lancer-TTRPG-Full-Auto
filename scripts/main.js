const MODULE_ID = "Lancer-TTRPG-Full-Auto";
const SOCKET = `module.${MODULE_ID}`;

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | init`);

  game.modules.get(MODULE_ID).api = {
    applyStatusByPlayer,
    removeStatusByPlayer,
    toggleStatusByPlayer
  };
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | ready`);

  game.socket.on(SOCKET, handleSocketMessage);

  registerLancerFlowHooks();
});

function registerLancerFlowHooks() {
  Hooks.on("lancer.postFlow.TalentFlow", async (flow, success) => {
    if (!success) return;

    const rankName = flow.state?.data?.rank?.name;
    if (rankName !== "Shield of Blades") return;

    const token = getSelectedOrSpeakerToken(flow);
    if (!token) return;

    await applyStatusByPlayer("cover_soft", [token]);
  });

  Hooks.on("lancer.postFlow.BasicAttackFlow", async (flow, success) => {
    // Later: Ram / Grapple / Improvised Attack automation.
  });

  Hooks.on("lancer.postFlow.TechAttackFlow", async (flow, success) => {
    // Later: Invade, Jammed, Impaired, Lock On interaction, etc.
  });

  Hooks.on("lancer.postFlow.SystemFlow", async (flow, success) => {
    // Later: mech systems that apply statuses or effects.
  });
}

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

  ui.notifications.error(`Could not change status ${statusId}; actor status API unavailable.`);
}

function getSelectedOrSpeakerToken(flow) {
  return canvas.tokens.controlled[0] ?? null;
}