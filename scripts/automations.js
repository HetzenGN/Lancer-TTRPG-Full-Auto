let moduleApi = null;

const TALENT_AUTOMATIONS = {
  "Shield of Blades": {
    target: "self",
    apply: ["cover_soft"],
    chatMessage: true
  }
};

export function registerAutomations(api) {
  moduleApi = api;

  Hooks.on("lancer.postFlow.TalentFlow", async (flow, success) => {
    if (!success) return;

    const data = flow.state?.data;
    const rankName = data?.rank?.name;
    const talentTitle = data?.title;

    const automation =
      TALENT_AUTOMATIONS[rankName] ??
      TALENT_AUTOMATIONS[talentTitle];

    if (!automation) return;

    const token = getSelfToken(flow);

    if (!token) {
      ui.notifications.warn(
        `Automation triggered for ${rankName ?? talentTitle}, but no active token was found.`
      );
      return;
    }

    for (const statusId of automation.apply ?? []) {
      await api.applyStatusByPlayer(statusId, [token]);
    }

    if (automation.chatMessage) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ token }),
        content: `<p><strong>${rankName ?? talentTitle}:</strong> Applied <strong>${formatStatusList(automation.apply)}</strong> to ${token.name}.</p>`
      });
    }
  });
}

export function makeActionApi(api) {
  moduleApi = api;

  return {
    ram: () => runRam(api)
  };
}

async function runRam(api) {
  const attackerToken = getSingleControlledToken();
  if (!attackerToken) return;

  const targetToken = getSingleTargetToken();
  if (!targetToken) return;

  if (!attackerToken.actor) {
    ui.notifications.warn("Selected token has no actor.");
    return;
  }

  if (!targetToken.actor) {
    ui.notifications.warn("Targeted token has no actor.");
    return;
  }

  const BasicAttackFlow = game.lancer?.flows?.get?.("BasicAttackFlow");

  if (!BasicAttackFlow) {
    ui.notifications.error("Could not find Lancer BasicAttackFlow.");
    return;
  }

  // BasicAttackFlow uses the currently targeted tokens when the attack HUD is created.
  // Passing title through begin() helps make the Lancer attack card say Ram instead of Basic Attack.
  const flow = new BasicAttackFlow(attackerToken.actor, {
    title: "Ram"
  });

  const success = await flow.begin({
    title: "Ram"
  });

  if (!success) {
    ui.notifications.info("Ram was cancelled.");
    return;
  }

  const hitResults = flow.state?.data?.hit_results ?? [];

  const result =
    hitResults.find(r => r.target?.document?.uuid === targetToken.document.uuid) ??
    hitResults.find(r => r.target?.id === targetToken.id) ??
    (hitResults.length === 1 ? hitResults[0] : null);

  if (!result) {
    ui.notifications.warn(
      "Ram completed, but no hit result was found. Make sure Lancer attack automation is enabled and that exactly one target was selected."
    );
    return;
  }

  if (!result.hit) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ token: attackerToken }),
      content: `<p><strong>Ram:</strong> ${attackerToken.name} missed ${targetToken.name}. <strong>Prone</strong> was not applied.</p>`
    });
    return;
  }

  await api.applyStatusByPlayer("prone", [targetToken]);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ token: attackerToken }),
    content: `<p><strong>Ram:</strong> ${attackerToken.name} hit ${targetToken.name}. Applied <strong>Prone</strong>.</p>`
  });
}

function getSingleControlledToken() {
  const controlled = canvas.tokens.controlled;

  if (controlled.length !== 1) {
    ui.notifications.warn("Select exactly one attacking token.");
    return null;
  }

  return controlled[0];
}

function getSingleTargetToken() {
  const targets = Array.from(game.user.targets);

  if (targets.length !== 1) {
    ui.notifications.warn("Target exactly one enemy token.");
    return null;
  }

  return targets[0];
}

function getSelfToken(flow) {
  if (canvas.tokens.controlled.length === 1) {
    return canvas.tokens.controlled[0];
  }

  const actor = flow.state?.actor;
  if (!actor) return null;

  const activeTokens = actor.getActiveTokens?.() ?? [];

  if (activeTokens.length === 1) {
    return activeTokens[0];
  }

  return null;
}

function formatStatusList(statusIds) {
  return Array.from(statusIds ?? [])
    .map(id => {
      const status = CONFIG.statusEffects.find(s => s.id === id);
      return status?.name ?? status?.label ?? id;
    })
    .join(", ");
}