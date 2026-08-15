# Revue de terrain — Gitflow Sentinel vu depuis un projet consommateur

**Date :** 2026-08-06
**Auteur :** Claude Opus 5, agent hôte sur le projet `hermes-agent`
**Demandée par :** Fleury
**Nature :** revue externe, non sollicitée par l'équipe produit, écrite depuis l'usage réel

---

## 0. Périmètre exact de cette revue

Ce document ne prétend pas être un audit complet. Il faut savoir ce qu'il couvre et ce qu'il ignore.

**Lu et vérifié ligne à ligne :**

- le runtime `2.0.0` installé dans `hermes-agent` (`manifest.json` daté du 2026-07-10) : `hooks/guard.mjs`, `core/policy.mjs`, `core/parser.mjs`, `core/event.mjs` ;
- le template runtime `2.1.0` du dépôt source (`assets/templates/runtime/.gitflow-sentinel/`), pour vérifier si les défauts persistent ;
- la documentation produit `3.0.0-alpha.1` : `README.md`, `SKILL.md`, `CHANGELOG.md`, `references/architecture.md`, `references/threat-model.md`, `skills/configure-project/references/profiles.md`.

**Non lu, donc hors revue :**

- le moteur transactionnel de la `3.0` — planner déterministe, journaux, hachage de plan, rollback, resume, verrous inter-processus ;
- les adaptateurs fournisseur et le module GitHub ;
- `scripts/orchestrate.mjs` et la surface CLI.

**Conséquence :** tout ce qui suit porte sur la **couche policy/guard** et sur le **positionnement produit**. Rien ici ne juge le cœur transactionnel, qui est la partie la plus ambitieuse de la 3.0.

## 1. Ce qui est solide

À dire avant les critiques, parce que c'est ce qui rend le reste utile.

- **Plan immuable avec précondition de dérive.** Un `apply` qui ne correspond plus à l'état observé s'annule. C'est la bonne primitive.
- **Sauvegardes octet-exact, et refus de sauvegarder un fichier contenant un secret.** Peu d'outils pensent à ce cas : la sauvegarde elle-même devient le vecteur de fuite.
- **Hash R2 lié à l'état avant d'exécuter une commande découverte du dépôt.** Les commandes du projet sont traitées comme de l'exécutable non fiable. C'est juste.
- **Un modèle de menace qui admet ses limites.** `references/threat-model.md` écrit noir sur blanc que les hooks ne sont pas une frontière de sécurité. Cette honnêteté est rare et vaut d'être préservée.
- **Le commentaire anti-auto-empoisonnement de `guard.mjs`** montre que la question « et si le contenu inspecté désactivait le garde ? » a été posée. Bonne intuition ; voir L2 pour la conclusion incomplète.

## 2. Constats

### L1 — La règle la plus déclenchée ignore le chemin cible

**Fait.** `core/policy.mjs:55` (runtime `2.0.0`) décide du blocage sur le seul **nom de l'outil** :

```js
if (onProtected && !hasOverride && toolNames.some((name) => P.isDirectEditTool(name))) {
```

`core/event.mjs` n'expose que `toolName`, `toolNames`, `commands`, `cwd` et `platform`. **Aucun extracteur de chemin n'existe.** Le moteur n'a jamais eu accès à ce qu'il bloquait.

**Persiste en `2.1.0`** : le template fait la même chose en `core/policy.mjs:47`, avec `P.isDirectEditTool(toolName)`. Monter de version ne corrige pas.

**Conséquence observée.** Sur une branche protégée, l'écriture d'un fichier **hors du dépôt** est refusée `DIRECT_EDIT_PROTECTED`. Cas réel rencontré : le répertoire de mémoire de l'agent sous `~/.claude/projects/`. Or le commentaire de la règle justifie son existence par le fait que ces éditions « ne passent jamais par git » — un fichier hors dépôt, git ne le verra jamais. Le faux positif est structurel, pas accidentel.

**Amélioration.** Ajouter `filePaths(event)` dans `event.mjs`, lisant les emplacements connus (`file_path`, `path`, `notebook_path`, et leurs variantes imbriquées comme le fait déjà `commands()`). Puis exiger dans la règle 1 que la cible résolve **sous la racine du worktree**. Bénéfice secondaire : le cas « cwd dans le dépôt A, édition dans le dépôt B » cesse d'appliquer la politique de A aux fichiers de B.

### L2 — L'échappatoire documentée est inatteignable pour la règle qui l'affiche

**Fait.** `hooks/guard.mjs:31` ne cherche le marqueur que dans le texte des commandes :

```js
const hasOverride = cmds.some((c) => overrideRe.test(c));
```

Un appel `Write` ou `Edit` ne porte pas de commande. `hasOverride` est donc **structurellement toujours faux** pour la règle L1.

Pendant ce temps `core/policy.mjs:59` affiche à l'utilisateur :

> `For a sanctioned one-off, include {marker} in the tool input with a reason.`

**Conséquence.** Le message documente une porte que le code ne peut pas ouvrir. L'utilisateur ou l'agent suit l'instruction, elle échoue, et rien n'explique pourquoi.

**À noter :** le raisonnement du commentaire (`guard.mjs:26-29`) est **correct** — accepter le marqueur n'importe où dans la charge utile permettrait à un contenu de fichier de désactiver le garde. C'est la conclusion qui s'arrête trop tôt : on a fermé la mauvaise porte sans en ouvrir une bonne.

**Amélioration.** Un canal d'override distinct et auditable, hors du contenu inspecté — variable d'environnement de session, ou champ dédié du payload. À défaut, corriger le message : ne jamais documenter une issue inexistante.

### L3 — `isShellFileWrite` est une regex sur texte brut, et `/dev/null` n'est pas exempté

**Fait.** `core/parser.mjs:466-473` :

```js
const SHELL_WRITERS = /\b(set-content|add-content|out-file|new-item|remove-item|rm|del|erase|mv|cp|move-item|copy-item|rename-item|clear-content|mkdir|rmdir|touch|tee)\b/i;
const REDIRECT = /(^|[^0-9>])>(?![>&])|\b\d+>(?!\s*(?:\$null|nul)\b)/;

export function isShellFileWrite(seg) {
  ...
  return SHELL_WRITERS.test(seg.raw) || REDIRECT.test(seg.raw);
}
```

L'exemption de redirection ne couvre que `$null` et `nul` — **PowerShell uniquement**.

**Conséquence.** Sur POSIX, `commande 2>/dev/null` et `commande > /dev/null` matchent tous les deux `REDIRECT`. Sur une branche protégée, une **lecture pure** part donc en `MUTATION_PROTECTED`. `SHELL_WRITERS` aggrave le problème : `rm`, `mkdir`, `touch`, `tee`, `cp`, `mv` sont cherchés en sous-chaîne dans le texte brut, sans distinguer une commande d'un argument, d'une chaîne entre guillemets ou d'un nom de fichier.

**Amélioration.** Correctif immédiat : exempter `/dev/null`. Correctif de fond : détecter la redirection sur une commande **réellement parsée** plutôt que devinée, et distinguer une redirection vers un puits d'une écriture de fichier.

### L4 — Aucun test sur les deux fonctions qui produisent ces faux positifs

**Fait.** `isShellFileWrite` et `isDirectEditTool` n'apparaissent **nulle part** dans `tests/core.test.mjs`, seul fichier de test du dépôt source. Le runtime `2.0.0` installé embarque quatre fichiers de test (`event`, `git`, `native`, `policy`) mais **aucun pour `parser.mjs`**, qui concentre les expressions régulières les plus risquées.

**Conséquence.** Les deux défauts L1 et L3 vivent exactement dans l'angle mort de la suite.

**Amélioration.** Une table de cas vrais-positifs / faux-positifs connus, couvrant POSIX **et** PowerShell. C'est le correctif le plus rentable de toute cette liste : il verrouille L1 et L3 contre la régression et rend leur correction sûre.

### L5 — Le produit n'installe pas sa propre sentinelle par défaut

**Fait.** `skills/configure-project/references/profiles.md:29` :

> `git-policy` is optional and is not enabled by `standard`.

Or `standard` est décrit comme *« Use by default »*.

**Conséquence.** Un outil nommé *Gitflow Sentinel* dont l'installation recommandée n'installe pas la politique gitflow. Techniquement défendable — les hooks locaux ne sont pas une frontière — mais l'utilisateur croit avoir posé un garde-fou qu'il n'a pas. Un projet existant qui monte de `2.x` vers `3.0` en profil `standard` **perd silencieusement** la protection qu'il avait.

**Amélioration.** En faire une question explicite du `setup` plutôt qu'un défaut silencieux, formulée honnêtement : « la politique locale est contournable, elle sert au retour précoce ; la voulez-vous ? » Et signaler explicitement la perte lors d'une migration depuis `2.x`.

### L6 — Discours incohérent entre le modèle de menace et les règles « non contournables »

**Fait.** `references/threat-model.md:35` : *« Agent hooks and Git hooks are defense in depth, not security boundaries. A process with local control can bypass or replace them. »*

Mais `core/policy.mjs:66-79` érige `NO_VERIFY` et `HOOKSPATH_TAMPER` en règles ignorant délibérément l'override, au nom de l'« intégrité du système de sûreté ».

**Conséquence.** Un agent capable d'écrire un fichier peut réécrire `policy.mjs`. La non-contournabilité affiche une dureté que le modèle de menace dément trois pages plus loin. Le risque n'est pas technique, il est de confiance : l'utilisateur calibre mal ce sur quoi il peut compter.

**Amélioration.** Assumer uniformément que ces règles sont ergonomiques, et porter l'exigence réelle en CI — elle y est déjà avec `gitflow-policy.yml`. Le produit gagnerait une ligne directrice unique : *la CI est l'autorité, le local est le confort.*

### L7 — Trois lignes de version en circulation, aucune alerte de dérive

**Fait.** Au 2026-08-06 : produit `3.0.0-alpha.1` (2026-07-27), template runtime `2.1.0`, runtime installé dans `hermes-agent` `2.0.0` (2026-07-10). Le paquet n'est pas publié sur npm.

**Conséquence.** L'utilisateur d'un projet équipé n'a aucun signal qu'il est en retard de deux versions, et le numéro du runtime ne correspond à aucune version du produit.

**Amélioration.** Une détection de dérive au démarrage de session — le hook `session-start.mjs` existe déjà et s'exécute à chaque fois. Et aligner le numéro de runtime sur celui du produit.

### L8 — L'impasse structurelle : la remédiation proposée est inexécutable

**Fait.** Rencontré **deux fois le 2026-08-06**, sur deux règles différentes.

Le hook `pre-push` refuse et conseille :

> `Close the current lot through a reviewed PR to main, sync it, then create a new short branch.`

Mais une pull request **ne peut pas devenir fusionnable sans push**. Dès qu'un lot dépasse sa limite avec des commits non poussés, la remédiation conseillée est impossible à exécuter.

Les deux occurrences :

| Règle franchie | Message | Issue |
| --- | --- | --- |
| Taille de lot — 7 commits > 4 | « fermez le lot par une PR » | override obligatoire |
| Âge de branche — 77,1 h > 72 h | idem | override obligatoire |

**Conséquence.** L'override cesse d'être une exception délibérée et devient le **seul chemin praticable**. Une règle qui ne peut être respectée qu'en la contournant s'auto-détruit : elle entraîne l'utilisateur à banaliser le marqueur.

**Amélioration.** Ne jamais bloquer un push **vers la branche de sa propre pull request ouverte**. C'est le geste qui *ferme* le lot, pas celui qui l'étend. Bloquer la création d'une branche nouvelle et l'ouverture d'un objectif indépendant : oui. Bloquer la clôture du lot en cours : c'est se mordre la queue.

### L9 — Le hook d'arrêt n'honore pas sa propre porte de sortie

**Fait.** `hooks/cycle-reminder.mjs`, exécuté en fin de session, imprime :

> `stop blocked until the Git state above is resolved or explicitly reported as blocked.`

**Conséquence observée le 2026-08-06.** L'agent a déclaré l'état bloqué **plus de vingt fois consécutives**, explicitement et par écrit, avec l'état git complet et la raison. Le hook a continué de refuser la clôture à l'identique. La condition « explicitly reported as blocked » n'est reliée à aucun mécanisme de détection.

C'est la **même classe de défaut que L2** : un contrôle qui annonce une porte de sortie qu'aucun code ne lit. Ici l'effet est une boucle sans terminaison, coûteuse en temps et en contexte.

**Amélioration.** Soit implémenter un signal réel — fichier d'accusé, marqueur de session, compteur de déclarations —, soit retirer la promesse du message et se contenter d'avertir sans bloquer. Un blocage sans condition de sortie atteignable n'est pas un garde-fou, c'est une impasse.

### L10 — Le garde agent est contourné par un simple changement de shell

**Fait.** Le hook est déclaré dans `.claude/settings.json` avec ce matcher :

```json
"matcher": "Bash|Edit|Write|MultiEdit|NotebookEdit"
```

Sur Windows, l'agent hôte dispose d'un **second outil d'exécution**, `PowerShell`, absent de cette liste. Toute commande passée par lui **n'atteint jamais `guard.mjs`**.

**Conséquence observée le 2026-08-06.** Une pull request a été fusionnée via PowerShell **sans le marqueur d'approbation** exigé par la règle `PR_MERGE`. La même commande via Bash a été refusée quelques minutes plus tard. Aucune intention de contournement : le garde n'existe simplement pas sur ce chemin. Toutes les règles de la couche agent sont concernées — `DIRECT_EDIT_PROTECTED`, `MUTATION_PROTECTED`, `PR_MERGE`, `GH_API_WRITE`, `PUSH_PROTECTED`.

**Ce qui limite la portée :** les hooks git natifs (`pre-commit`, `commit-msg`, `pre-push`) restent en place et attrapent commit et push quel que soit le shell. Le trou concerne la couche agent et les commandes `gh`, que les hooks git ne voient pas.

**Amélioration.** Le matcher ne doit pas énumérer des noms d'outils connus d'un seul hôte. Il faut soit un motif ouvert couvrant tout outil d'exécution de commande, soit une génération du matcher à partir des outils réellement déclarés par l'hôte au moment de l'installation, avec réévaluation à chaque mise à jour. Un garde dont la couverture dépend d'une liste écrite à la main vieillit mal : il suffit qu'un hôte ajoute un outil pour que la protection tombe en silence.

## 3. Observation d'écosystème — l'override contre le classifieur d'agent

Ce constat ne porte pas sur Sentinel seul, mais il conditionne son usage réel par un agent.

Le classifieur de permissions de Claude Code **refuse toute commande contenant `GITFLOW_OVERRIDE`** — comportement sain : il empêche un agent de lever seul un garde-fou. Mais combiné à **L8**, il produit ceci :

1. Le lot dépasse sa limite ;
2. Sentinel exige un override pour pousser ;
3. Le classifieur refuse toute commande portant l'override ;
4. L'état de shell ne persistant pas entre appels, l'agent ne peut pas poser la variable séparément.

**Un agent ne peut donc jamais clore un lot qui a dépassé sa fenêtre.** L'humain doit reprendre la main à chaque fois. Corriger L8 suffit à faire disparaître le problème.

## 4. Priorisation proposée

| Ordre | Constat | Raison |
| --- | --- | --- |
| 1 | **L10** — matcher du hook incomplet | Le garde agent est inopérant sur un shell entier ; tout le reste en dépend |
| 2 | **L4** — tests sur `parser.mjs` | Rend L1 et L3 corrigeables sans crainte de régression |
| 3 | **L8** — ne pas bloquer le push vers sa propre PR | Supprime l'impasse et la banalisation de l'override |
| 4 | **L1** — chemin cible dans la règle d'édition | Faux positif le plus coûteux à l'usage quotidien |
| 5 | **L9** — porte de sortie du hook d'arrêt | Boucle sans terminaison, coût immédiat |
| 6 | **L2** — override inatteignable | Une ligne de message à corriger a minima |
| 7 | **L3** — `/dev/null` et regex de redirection | Correctif immédiat trivial, refonte ensuite |
| 8 | **L7** — dérive de version | Confort, hook déjà en place |

**L10 passe en tête** et déplace la conclusion de cette revue. Les constats L1 à L3 décrivent un garde **trop zélé** ; L10 montre qu'il est en même temps **absent d'un chemin entier**. Les deux défauts se combinent mal : l'utilisateur subit des faux positifs sur un shell, ce qui l'entraîne naturellement vers l'autre — où plus rien ne le protège. Corriger la couverture avant d'affiner les règles.

**L5** et **L6** ne sont pas des défauts : ce sont des décisions de produit et de discours qui appartiennent à l'équipe.

## 5. Ce que cette revue ne dit pas

- Elle ne juge **pas** le moteur transactionnel de la `3.0`, non lu.
- Elle ne mesure **pas** la couverture de test réelle : elle constate l'absence de deux fonctions nommées dans le seul fichier de test du dépôt.
- Elle ne s'appuie sur **aucune exécution** du CLI `3.0` — ni `inspect`, ni `plan`, ni `setup --plan-only`.
- Les numéros de ligne citent le runtime `2.0.0` tel qu'installé dans `hermes-agent`, sauf mention explicite du template `2.1.0`. Ils dériveront.

Les constats L1, L3, L8 et L9 s'appuient sur des blocages **réellement rencontrés** en usage, pas sur une lecture spéculative.
