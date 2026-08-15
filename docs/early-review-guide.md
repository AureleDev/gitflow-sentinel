# Guide des premières revues

Ce guide aide à essayer l'alpha sans exposer un projet important. Une revue ne
doit jamais contenir de secret, dépôt privé, nom de client ou donnée personnelle.

## Préparation commune

Prérequis : Git, Node.js 18 ou supérieur et un dossier jetable.

```bash
npx --yes gitflow-sentinel@next bootstrap
gitflow-sentinel --version
```

Sous Windows, remplacez `gitflow-sentinel` par `gitflow-sentinel.cmd` si
PowerShell bloque le shim `.ps1`.

## Parcours A — dossier vide

1. Créez un dossier vide et placez-vous dedans.
2. Lancez `gitflow-sentinel setup --plan-only`.
3. Vérifiez que le plan explique l'initialisation Git et chaque fichier proposé.
4. Lancez `gitflow-sentinel setup` et n'approuvez que les groupes compris.
5. Exécutez `gitflow-sentinel verify --json --compact`.
6. Générez une seconde fois le plan : aucune action supplémentaire ne devrait
   être proposée si l'état n'a pas changé.
7. Si une transaction a été créée, essayez `rollback` dans cette copie jetable
   et comparez l'état avec le point de départ.

La création GitHub, le push et la publication ne font pas partie de ce parcours.

## Parcours B — dépôt existant

1. Faites une copie indépendante d'un petit dépôt représentatif.
2. Notez le commit, l'état du worktree et les fichiers de configuration présents.
3. Lancez `gitflow-sentinel setup --plan-only`.
4. Vérifiez que les outils existants sont détectés et qu'aucune configuration
   personnalisée n'est remplacée silencieusement.
5. Si Sentinel découvre une commande de qualité, examinez d'abord le hash R2
   affiché par `gitflow-sentinel check . -- <commande>`.
6. Appliquez uniquement un plan compris, puis lancez `verify` et un second plan.
7. Testez la restauration et comparez les fichiers octet par octet si possible.

## Parcours C — demande naturelle à une IA

Après `bootstrap`, ouvrez Codex, Claude Code ou OpenCode dans la copie de test et
demandez :

> Configure-moi complètement ce projet avec Gitflow Sentinel. Commence par un
> audit et n'applique rien avant mes approbations.

Avant de lancer la demande, activez le mode Plan lorsque l'interface le propose.
Vérifiez également que l'agent peut poser des questions interactives :

- Codex : outil de question structurée disponible en mode Plan ;
- Claude Code : `AskUserQuestion` disponible ;
- OpenCode : permission `question` réglée sur `allow` ou `ask`.

Si cette capacité n'existe pas, l'agent doit poser chaque décision en texte
normal et attendre la réponse avant de poursuivre. Notez ce repli dans votre
retour : l'objectif est de tester également les hôtes sans formulaire intégré.

Observez si l'agent :

- inspecte avant de conseiller ;
- distingue les faits des recommandations ;
- demande seulement les décisions non déductibles, avec des choix structurés
  lorsqu'ils sont disponibles ;
- présente le plan et ses risques sans inventer une approbation ;
- utilise le CLI pour appliquer et vérifier ;
- ne commet, ne pousse et ne modifie jamais GitHub de lui-même.

## Résultat à partager

Ouvrez le formulaire « Première revue » et indiquez l'environnement, le projet
anonymisé, les étapes, le résultat du second plan, le résultat de la restauration
et la correction qui vous paraît prioritaire. Une sortie complète n'est utile
que si elle est nécessaire au diagnostic et entièrement expurgée.
