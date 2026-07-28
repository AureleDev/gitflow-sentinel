# Gitflow Sentinel

Gitflow Sentinel est un orchestrateur de fondations de projet conçu pour être
piloté aussi bien par une personne que par Codex, Claude Code ou OpenCode.

Il inspecte un dossier, construit un état désiré, explique les écarts, produit
un plan immuable, puis n'applique ce plan qu'après approbation explicite. Les
changements locaux sont transactionnels et restaurables. Les actions GitHub
sensibles demandent une confirmation dédiée.

> Version actuelle : `3.0.0-alpha.1`. Le nom historique et les anciennes
> commandes restent disponibles pendant la migration.

## Principes

- L'IA comprend le projet et guide les choix ; le moteur déterministe inspecte,
  planifie, applique, vérifie et restaure.
- `inspect`, `init`, `plan`, `status`, `verify` et `doctor` sont en lecture seule.
  Ils restent locaux par défaut ; `--remote` autorise explicitement la lecture
  de GitHub et `--offline` interdit toute consultation distante.
- Un plan contient les empreintes du dépôt, des fichiers et de l'état distant.
  Une dérive entre `plan` et `apply` annule l'opération.
- Aucun commit, push, changement GitHub ou publication n'est automatique.
- Les contenus du dépôt sont des données non fiables : ils ne deviennent jamais
  des instructions à exécuter.
- Tous les hooks locaux sont contournables. La CI et les règles de la forge sont
  les autorités partagées.
- Les valeurs secrètes ne sont ni affichées, ni copiées, ni journalisées.

## Installation

Node.js 18 ou supérieur est requis.

```bash
npm install --global gitflow-sentinel
```

Pour tester une copie locale :

```bash
npm link
gitflow-sentinel doctor
```

## Parcours recommandé

```bash
# 1. Inventaire versionné et expurgé des secrets
gitflow-sentinel inspect . --json > snapshot.json

# Ajouter --remote seulement lorsqu'un diff GitHub est nécessaire
gitflow-sentinel inspect . --remote --json

# 2. Parcours greenfield ou brownfield ; produit un plan sans modifier le projet
gitflow-sentinel init .

# 3. Ou génération directe d'un plan
gitflow-sentinel plan . --profile standard --json > sentinel-plan.json

# 4. Application exacte du plan approuvé
gitflow-sentinel apply --plan sentinel-plan.json --approve <plan-hash>

# 5. Contrôle de l'état obtenu
gitflow-sentinel verify . --json
gitflow-sentinel status .
```

Une commande de qualité découverte dans le dépôt n'est jamais exécutée
automatiquement. Elle suit un mini-plan R2 distinct :

```bash
# Aperçu seulement : aucun processus n'est lancé
gitflow-sentinel check . -- npm test

# Exécution exacte après approbation du hash affiché
gitflow-sentinel check . --approve <check-hash> -- npm test
```

La preuve enregistrée est liée au commit, à la branche et à l'état exact du
worktree. La sortie de la commande n'est pas conservée ; seul son condensat est
journalisé. La CI n'est générée que si chaque commande déclarée dans
`quality.verifiedCommands` possède une preuve encore valide.

Chaque groupe R2 affiché dans le plan exige
`--approve-r2 <groupe>:<hash>`. Une action distante de niveau R3 exige en plus
`--approve-r3 <action-id>`. L'outil ne crée jamais de commit et ne pousse
jamais le code.

En cas d'interruption :

```bash
gitflow-sentinel resume <transaction-id>
gitflow-sentinel rollback <transaction-id>
```

Pour recalculer les changements d'une nouvelle version :

```bash
gitflow-sentinel update . --profile standard
```

La désinstallation du nouveau moteur commence elle aussi par un plan :

```bash
gitflow-sentinel uninstall .                       # aperçu + hash
gitflow-sentinel uninstall . --approve <hash>     # restauration locale
```

Elle retire uniquement les éléments dont les transactions prouvent la propriété
et restaure leurs octets précédents. `legacy-uninstall` reste disponible pour
une installation historique 2.x.

## Profils

| Profil | Contenu |
|---|---|
| `minimal` | Git, instructions IA, sécurité essentielle |
| `standard` | Minimal + documentation, qualité détectée, CI, dépendances et sécurité |
| `hardened` | Standard + règles distantes renforcées, CODEOWNERS, CodeQL et revue |
| `custom` | Modules explicitement sélectionnés |

Le fichier déclaratif est `sentinel.config.json`. Il est validé par le schéma
local [`assets/sentinel/schema.json`](assets/sentinel/schema.json). Les journaux,
preuves de qualité, sauvegardes et transactions restent sous `.git/sentinel/`
et ne sont jamais
suivis par Git.

## Niveaux de risque

| Niveau | Exemple | Approbation |
|---|---|---|
| R0 | Inspection, diagnostic, vérification | Aucune |
| R1 | Création locale additive et réversible | Hash global du plan |
| R2 | Modification d'un fichier, d'une branche ou de hooks | Hash dédié par groupe d'actions |
| R3 | Dépôt GitHub, visibilité, ruleset, secret, publication ou suppression | Confirmation dédiée par action |

## Architecture

```text
Agent hôte
  └─ skill configure-project
       └─ CLI Gitflow Sentinel
            ├─ inspection et contrats versionnés
            ├─ état désiré et planification
            ├─ transactions et restauration
            ├─ modules de fondation
            └─ adaptateur GitHub
```

Les modules V1 partagent un contrat exécutable
`detect/recommend/plan/apply/verify/rollback/uninstall` et couvrent Git, GitHub,
instructions IA, documentation, qualité,
CI, sécurité, dépendances et préparation de versions. Cloud, domaines, bases de
données et déploiement restent hors du cœur V1.

Les contrats JSON (`ProjectSnapshot`, `DesiredState`, `ChangePlan` et
`TransactionRecord`) sont versionnés. L'adaptateur GitHub applique un ruleset
dédié sans remplacer les réglages que Sentinel ne gère pas.

Voir :

- [Architecture](references/architecture.md)
- [État désiré et configuration](references/configuration.md)
- [Modèle de menace](references/threat-model.md)
- [Compatibilité des agents](references/platform-adapters.md)
- [Migration](references/migration.md)

## Skill portable et plugin Codex

La procédure commune se trouve dans
[`skills/configure-project`](skills/configure-project/SKILL.md). Elle suit le
cycle :

```text
inspecter → expliquer → demander les choix non déductibles
→ planifier → approuver → appliquer → vérifier
```

Le même skill peut être installé sous `.agents/skills/configure-project`.
Sentinel génère uniquement les adaptations nécessaires pour Claude Code et
OpenCode. Le manifeste [`.codex-plugin/plugin.json`](.codex-plugin/plugin.json)
permet aussi de distribuer le dépôt comme plugin Codex. Aucun modèle intégré,
serveur MCP ou clé API n'est requis.

## Compatibilité historique

`doctor`, `install`, `orchestrate`, `github-protect` et `legacy-uninstall` restent
disponibles pour les installations 2.x. Ils émettent une indication de
migration lorsqu'un parcours équivalent existe. La politique Git historique est
désormais planifiée comme un module de Sentinel Core et non comme le produit
entier.

## Développement et validation

```bash
npm test
npm run verify
npm run validate:evals
npm run validate:package
npm run validate:self-host
npm pack --dry-run
```

La matrice brownfield peut être exécutée sur des copies temporaires de projets
réels, sans modifier les sources :

```bash
node scripts/validate-project-matrix.mjs \
  --source /path/to/python-project \
  --source /path/to/node-project \
  --source /path/to/monorepo \
  --profile standard
```

La suite couvre notamment les dépôts greenfield et brownfield, l'idempotence,
les plans périmés, l'interruption après chaque famille d'action locale, les
verrous concurrents, la restauration des octets et modes, les chemins hostiles,
les dossiers parents vides, les chemins longs Windows, les configurations
invalides, les sauvegardes sensibles et l'expurgation des identifiants dans les
remotes.

## Licence

[MIT](LICENSE) © 2026 Aurele Gnonlonfoun
([@AureleDev](https://github.com/AureleDev)).
