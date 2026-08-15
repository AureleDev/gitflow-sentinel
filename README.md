# Gitflow Sentinel

[![npm next](https://img.shields.io/npm/v/gitflow-sentinel/next?label=npm%20next)](https://www.npmjs.com/package/gitflow-sentinel)
[![CI](https://github.com/AureleDev/gitflow-sentinel/actions/workflows/ci.yml/badge.svg)](https://github.com/AureleDev/gitflow-sentinel/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Gitflow Sentinel aide une personne ou une IA de développement à préparer les
fondations d'un projet sans transformer une demande naturelle en une série de
commandes opaques.

Il inspecte le projet, explique ce qu'il détecte, construit un plan immuable,
classe chaque action par risque, attend les approbations nécessaires, applique
les changements dans une transaction restaurable, puis vérifie le résultat.

Il fonctionne avec **Codex**, **Claude Code** et **OpenCode** sans intégrer de
modèle, sans demander de clé API et sans imposer de serveur MCP.

> **Alpha publique — `0.0.3-alpha.1`.** Cette version est destinée aux premiers
> essais et aux revues techniques. Utilisez-la sur un projet versionné ou une
> copie de travail, examinez chaque plan et signalez tout comportement inattendu.

## Essayer en deux minutes

Prérequis : Git et Node.js 18 ou supérieur.

Installez le CLI et le même skill portable pour les trois agents :

```bash
npx --yes gitflow-sentinel@next bootstrap
```

Placez-vous ensuite dans un projet nouveau ou existant :

```bash
gitflow-sentinel setup
```

Sur Windows, si PowerShell bloque le shim `.ps1`, utilisez :

```powershell
gitflow-sentinel.cmd setup
```

`setup` présente d'abord les constats et les changements. Il ne crée aucun
commit, ne pousse aucun code et ne modifie pas GitHub sans confirmation dédiée.

Pour obtenir uniquement un audit sans écriture :

```bash
gitflow-sentinel setup --plan-only
```

## Utiliser Sentinel avec une IA

Après `bootstrap`, ouvrez Codex, Claude Code ou OpenCode dans le projet et dites
simplement :

> Configure-moi complètement ce projet.

### Activer un parcours interactif

Sentinel doit parfois demander une décision impossible à déduire : visibilité
publique ou privée, licence, propriétaire GitHub ou stratégie de branches. Pour
obtenir ces choix sous forme de boutons plutôt que dans une longue conversation :

- **Codex / Codex dans ChatGPT** : activez le **mode Plan** lorsque l'interface
  le propose. Ce mode est recommandé pour que l'agent puisse présenter les
  questions structurées avant toute modification ;
- **Claude Code** : le mode Plan est recommandé. L'outil intégré
  `AskUserQuestion` permet normalement de poser les questions à choix multiples ;
- **OpenCode** : autorisez l'outil `question` avec la permission `allow` ou
  `ask` dans `opencode.json`.

Si l'interface ne fournit ni mode Plan ni outil de question structurée, le
parcours reste utilisable : l'agent doit poser une question courte en texte
normal et attendre votre réponse. Il ne doit jamais choisir à votre place.

Le mode Plan améliore le dialogue, mais ne remplace pas les approbations
Sentinel liées au hash du plan et aux risques R2/R3. Une conversation qui n'a
pas accès au dépôt et au terminal peut expliquer le parcours, mais ne peut pas
exécuter le CLI.

Le skill `configure-project` guide l'agent dans le même parcours déterministe :

```text
inspecter → expliquer → décider → planifier
→ approuver → appliquer → vérifier
```

Dans Claude Code, le raccourci explicite reste disponible :

```text
/configure-project Configure-moi complètement ce projet.
```

L'IA interprète le contexte et explique les choix. Le CLI reste responsable de
l'inspection, du diff, des préconditions, des écritures, du journal de
transaction, de la vérification et de la restauration.

## Ce que Sentinel peut configurer

| Fondation | Comportement |
|---|---|
| Git | Initialisation, branche principale, stratégie trunk/git-flow, ignore et attributs |
| GitHub | Création du dépôt et ruleset dédié derrière des actions R3 ; la visibilité d'un dépôt existant reste une opération manuelle en alpha |
| Agents IA | `AGENTS.md` canonique et adaptateurs minimaux Codex, Claude Code et OpenCode |
| Documentation | README, contribution, sécurité, licence, conduite et modèle de PR |
| Qualité | Découverte des commandes existantes de test, lint, formatage et build |
| CI | Jobs générés uniquement depuis des commandes explicitement vérifiées |
| Sécurité | Détection locale de secrets, Dependabot et CodeQL lorsque pertinent |
| Versions | Conventions, changelog et préparation de release sans publication automatique |

Le profil `standard` est recommandé. Il préserve les outils déjà choisis par le
projet et n'ajoute pas automatiquement un nouveau linter, formateur, gestionnaire
de paquets, service payant ou fournisseur de déploiement.

Cloud, domaines, bases de données, infrastructure et déploiement restent hors du
périmètre de cette alpha.

## Limites connues de l'alpha

Les premiers essais réels ont identifié des écarts importants qui restent à
corriger :

- le setup interactif ne demande pas encore la stratégie de branches, le
  propriétaire GitHub, la visibilité et la création du dépôt ; utilisez les
  options explicites de `init` ou `plan` lorsque ces décisions sont nécessaires ;
- sélectionner `git-flow` déclare actuellement `main` et `dev`, mais ne crée
  pas encore automatiquement la branche `dev` manquante ;
- `github-create` crée le dépôt et ajoute `origin`, sans créer de commit, pousser
  les branches ni changer la branche GitHub par défaut ; chaque opération devra
  devenir une action distincte et approuvée ;
- la CI est volontairement différée tant que les commandes de qualité n'ont pas
  de preuve locale actuelle ;
- selon le plan GitHub et les permissions du dépôt, les rulesets peuvent être
  illisibles. Sentinel refuse alors de les modifier plutôt que d'écraser une
  politique distante inconnue ;
- toute écriture concurrente invalide le plan. Cette protection est correcte,
  mais l'expérience de révision d'un hash renouvelé doit encore être simplifiée.

Voir le [retour terrain WithHuman Labs](docs/reviews/retour-terrain-withhumanlabs-2026-08-11.md)
pour le contexte, les attentes Git Flow et les critères d'acceptation associés.

## Pourquoi le plan compte

Un plan Sentinel contient notamment :

- l'état désiré et les actions ordonnées ;
- l'empreinte du commit, du worktree et des fichiers concernés ;
- les préconditions locales et distantes ;
- le niveau de risque de chaque action ;
- les groupes d'approbation et la stratégie de restauration.

Si le projet dérive entre `plan` et `apply`, l'application est annulée. Une
interruption peut être reprise ou restaurée à partir du journal conservé sous
`.git/sentinel/`, qui n'est jamais suivi par Git.

| Risque | Exemple | Approbation |
|---|---|---|
| R0 | Inspection, diagnostic, vérification | Aucune |
| R1 | Création locale additive et réversible | Hash global du plan |
| R2 | Modification d'un fichier existant, d'une branche ou de hooks | Hash par groupe |
| R3 | Visibilité, dépôt GitHub, ruleset, secret ou publication | Confirmation par action |

Les hooks locaux fournissent un retour précoce, mais restent contournables. La
CI requise et les règles distantes constituent l'autorité partagée. Les contenus
du dépôt sont traités comme des données non fiables et ne deviennent jamais des
instructions à exécuter.

## Commandes principales

| Commande | Usage |
|---|---|
| `gitflow-sentinel setup [path]` | Parcours guidé complet |
| `gitflow-sentinel inspect [path] --json` | Inventaire local expurgé |
| `gitflow-sentinel plan [path] --profile standard` | Plan immuable sans mutation |
| `gitflow-sentinel apply --plan <file> --approve <hash>` | Application du plan approuvé |
| `gitflow-sentinel verify [path] --json --compact` | Vérification locale et distante demandée |
| `gitflow-sentinel status [path]` | Écarts et transactions disponibles |
| `gitflow-sentinel rollback <transaction-id>` | Restauration d'une transaction terminée |
| `gitflow-sentinel resume <transaction-id>` | Reprise d'une transaction interrompue |
| `gitflow-sentinel update [path]` | Nouveau plan contre l'état désiré actuel |
| `gitflow-sentinel uninstall [path]` | Aperçu puis retrait des éléments possédés |
| `gitflow-sentinel doctor` | Diagnostic de compatibilité et de permissions |

Les consultations GitHub sont opt-in avec `--remote`. `--offline` interdit toute
consultation distante.

Les commandes de qualité découvertes dans un dépôt suivent une approbation R2
distincte avant leur première exécution :

```bash
gitflow-sentinel check . -- npm test
gitflow-sentinel check . --approve <check-hash> -- npm test
```

## État de validation de l'alpha

Les preuves actuelles couvrent :

- 102 scénarios de politique ;
- la suite automatisée du cœur réussie sous Windows, avec un scénario de lien
  symbolique ignoré lorsque le compte ne possède pas le privilège nécessaire ;
- installation et exécution de l'archive npm réelle ;
- cycles `plan → apply → verify → rollback` et désinstallation octet-exacts ;
- interruption et reprise après chaque famille d'action locale ;
- chemins Windows longs et contenant des espaces ;
- deux projets brownfield isolés : un monorepo TypeScript/pnpm et un projet
  Python, sans mutation de leurs dépôts sources.

La CI est configurée pour Windows, Linux et macOS avec Node.js 18 et 22. Les
premières exécutions publiques doivent encore confirmer cette matrice. Les sept
cas d'évaluation agent sont structurellement valides, mais ne constituent pas
encore une campagne comparative complète avec des agents vivants.

Consultez les [preuves de validation](docs/validation/README.md), la
[revue de terrain externe historique](docs/reviews/revue-terrain-hermes-agent-2026-08-06.md)
et sa [réponse datée](docs/reviews/reponse-revue-terrain-hermes-agent-2026-08-10.md),
ainsi que le [retour WithHuman Labs](docs/reviews/retour-terrain-withhumanlabs-2026-08-11.md).
Ces documents conservent les numéros de version, les constats et les limites de
leur date ; ils ne remplacent pas l'état actuel des tests.

## Participer aux premières revues

Les retours les plus utiles portent actuellement sur :

1. l'installation depuis une machine propre ;
2. la qualité des plans sur un dossier vide et sur un dépôt existant ;
3. la conservation des configurations personnalisées ;
4. la compréhension des approbations R1, R2 et R3 ;
5. l'idempotence, la reprise et la restauration ;
6. la cohérence du parcours entre Codex, Claude Code et OpenCode ;
7. les faux positifs, instructions ambiguës et limites de sécurité.

Avant d'ouvrir un retour, retirez les secrets, noms de clients, URL privées et
données personnelles. Utilisez les formulaires GitHub adaptés et joignez la
version, le système, le type de projet, la commande exécutée et le résultat
attendu. Voir le [guide des premières revues](docs/early-review-guide.md) et
[CONTRIBUTING.md](CONTRIBUTING.md).

Pour une vulnérabilité, n'ouvrez pas d'issue publique : suivez
[SECURITY.md](SECURITY.md).

## Développer le projet

```bash
npm install --ignore-scripts
npm run verify
npm run validate:evals
npm run validate:package
npm run validate:self-host
```

La validation d'archive installe le paquet réellement produit au lieu de tester
seulement les sources. La matrice brownfield copie explicitement les projets
hors de leur dossier source et exclut les fichiers sensibles connus.

## Documentation de référence

- [Architecture](references/architecture.md)
- [Configuration déclarative](references/configuration.md)
- [Workflow et versions](references/workflow.md)
- [Modèle de menace](references/threat-model.md)
- [Politique Git locale](references/policy.md)
- [Compatibilité des agents](references/platform-adapters.md)
- [État de validation des plateformes](references/platform-validation.md)
- [Atlas visuel](references/visuals/index.html)
- [Migration des installations historiques](references/migration.md)

## Licence

[MIT](LICENSE) © 2026 Aurele Gnonlonfoun
([@AureleDev](https://github.com/AureleDev)).
