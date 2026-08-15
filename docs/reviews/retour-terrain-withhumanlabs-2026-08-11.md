# Retour terrain WithHuman Labs - 2026-08-11

## Contexte

Le parcours `gitflow-sentinel setup` a été utilisé pour initialiser le dépôt
documentaire `WithHumanLabs`, créer son dépôt GitHub privé et préparer son
schéma de branches. Le projet impose Git Flow : `main` est stable et `dev` est
la branche d'intégration obligatoire.

## Corrections et limites observées

1. Le profil standard a d'abord proposé `trunk`, avec `main` à la fois stable
   et intégration. Le parcours guidé doit demander le schéma de branches quand
   cette décision n'est pas déjà enregistrée, au lieu de rendre le choix
   `trunk` presque invisible.
2. `--strategy git-flow` enregistre correctement `main` et `dev` dans
   `sentinel.config.json`, mais le plan ne crée pas réellement la branche
   `dev`. La conformité déclarative peut donc être affichée alors que la
   branche d'intégration n'existe pas encore.
3. La création GitHub est disponible avec `--create-github`,
   `--github-owner` et `--visibility`, mais `setup` ne recueille pas encore ces
   décisions dans ses questions initiales.
4. L'action `github-create` crée le dépôt et ajoute `origin`, mais ne crée aucun
   commit, ne pousse aucune branche et ne configure pas la branche GitHub par
   défaut. L'utilisateur s'attendait à un parcours guidé complet et explicite.
5. La CI qualité est différée lorsqu'aucune commande n'a été vérifiée. Cette
   protection est correcte, mais le parcours doit expliquer immédiatement
   pourquoi aucun workflow GitHub Actions n'est créé et proposer l'étape
   concrète permettant de fournir une preuve locale.
6. Des écritures BMAD simultanées ont invalidé deux plans entre leur revue et
   leur application. Le refus des plans périmés est correct. L'expérience doit
   toutefois détecter un dossier encore actif, attendre une courte fenêtre de
   stabilité et présenter une confirmation concise du nouveau hash lorsque la
   surface d'actions est strictement inchangée.
7. Le contrôle initial `git diff --cached --check` a remonté des espaces finaux
   et fins de fichiers préexistants dans des ressources BMAD. Sentinel ne doit
   pas les réécrire silencieusement ; ils doivent être signalés comme dette de
   qualité distincte.

## Schéma de branches requis

- `main` : branche stable et protégée ;
- `dev` : branche d'intégration obligatoire, protégée et branche GitHub par
  défaut ;
- `feat/*`, `fix/*`, `docs/*`, `chore/*` : branches courtes vers `dev` ;
- `release/*` et `hotfix/*` : routes contrôlées vers `main` ;
- aucune fonctionnalité ordinaire ne doit être intégrée directement dans
  `main`.

## Améliorations attendues dans Sentinel

- Ajouter au setup interactif les décisions stratégie, propriétaire GitHub,
  visibilité, création du dépôt et synchronisation initiale.
- Planifier une action locale explicite de création de `dev` lorsque Git Flow
  est sélectionné et que la branche manque.
- Représenter séparément dans le plan le commit initial, le push de `main`, le
  push de `dev` et le changement de branche GitHub par défaut, avec les niveaux
  de risque et approbations adaptés.
- Après la première synchronisation, recalculer l'état distant et proposer la
  protection de `main` et `dev` sans remplacer les règles GitHub étrangères à
  Sentinel.
- Afficher une limite claire lorsque GitHub ne permet pas de lire ou modifier
  les rulesets du dépôt privé.
- Conserver l'interdiction de générer une CI à partir d'une commande seulement
  détectée ou non prouvée.

## Critères d'acceptation

1. Sur un dossier sans Git, le setup Git Flow aboutit à `main` et `dev`
   existantes localement et à distance, avec `dev` comme branche par défaut.
2. Chaque écriture distante reste visible et approuvée, mais le parcours ne
   redemande pas des décisions produit déjà confirmées.
3. Un changement concurrent invalide toujours le plan ; si les actions restent
   identiques, le nouvel examen met uniquement en évidence le changement
   d'empreinte.
4. L'absence de workflow CI est expliquée avec la commande exacte à vérifier,
   ou avec la mention qu'aucune commande candidate sûre n'existe.
5. La vérification finale distingue clairement conformité locale, branches
   distantes, branche GitHub par défaut, rulesets lisibles et CI effectivement
   présente.

## Résultat du parcours concerné

Le dépôt privé `AureleDev/WithHumanLabs` a finalement été créé. Le commit
initial a été poussé sur `main`, puis `dev` a été créée depuis ce même commit,
poussée et définie comme branche GitHub par défaut. Les protections distantes
et la CI doivent encore être vérifiées séparément ; elles ne sont pas prouvées
par la seule création des branches.
