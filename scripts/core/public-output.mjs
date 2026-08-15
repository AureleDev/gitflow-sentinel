function actionSummary(action) {
  return {
    id: action.id,
    module: action.module,
    type: action.type,
    risk: action.risk,
    description: action.description,
    ...(action.target ? { target: action.target } : {}),
  };
}

export function compactPlan(plan) {
  return {
    kind: plan.kind,
    schemaVersion: plan.schemaVersion,
    id: plan.id,
    hash: plan.hash,
    root: plan.root,
    profile: plan.profile,
    desiredState: {
      profile: plan.desiredState.profile,
      project: plan.desiredState.project,
      vcs: plan.desiredState.vcs,
      agents: plan.desiredState.agents,
      modules: plan.desiredState.modules,
    },
    summary: plan.summary,
    actions: plan.actions.map(actionSummary),
    approvalGroups: plan.approvalGroups,
    recommendations: plan.recommendations,
  };
}

export function compactSnapshot(snapshot) {
  return {
    kind: snapshot.kind,
    schemaVersion: snapshot.schemaVersion,
    root: snapshot.root,
    project: snapshot.project,
    git: {
      isRepo: snapshot.git.isRepo,
      branch: snapshot.git.branch,
      head: snapshot.git.head,
      dirty: snapshot.git.dirty,
      defaultBranch: snapshot.git.defaultBranch,
      hooksPath: snapshot.git.hooksPath,
    },
    technology: {
      languages: snapshot.technology.languages,
      packageManagers: snapshot.technology.packageManagers,
      monorepo: snapshot.technology.monorepo,
      manifests: snapshot.technology.manifests,
      scripts: Object.keys(snapshot.technology.scripts || {}).sort(),
    },
    agents: snapshot.agents,
    provider: {
      github: {
        checked: snapshot.provider.github.checked,
        connected: snapshot.provider.github.connected,
        slug: snapshot.provider.github.slug,
      },
    },
  };
}

export function compactPendingActions(actions) {
  return actions.map(actionSummary);
}
