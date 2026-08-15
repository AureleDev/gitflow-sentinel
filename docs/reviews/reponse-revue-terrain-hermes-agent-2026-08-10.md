# Réponse à la revue de terrain Hermes Agent

**Date de résolution :** 2026-08-10
**Revue source :** `docs/reviews/revue-terrain-hermes-agent-2026-08-06.md`
**Périmètre :** runtime et CLI `3.0.0-alpha.1`

La revue source est conservée telle quelle comme preuve historique. Ce document
trace séparément la réponse apportée à chacun de ses constats. Les corrections
ont été vérifiées sur Windows et sur des copies isolées de deux projets réels ;
elles ne constituent pas encore une preuve d'exécution macOS ou Linux.

## Résolution des constats

| Constat | État | Réponse implémentée | Preuve de non-régression |
| --- | --- | --- | --- |
| L1 — chemin cible ignoré | Résolu | Le runtime extrait les chemins des outils, y compris les variantes imbriquées, puis ne soumet à la politique du dépôt que les cibles situées dans son worktree. La comparaison canonise aussi les alias de chemin Windows court/long. Une cible inconnue ou interne échoue prudemment ; une cible explicitement externe est laissée au projet qui la possède. | Tests unitaires de `filePaths`, de la relation au worktree et test réel du garde depuis un chemin Windows avec espaces. |
| L2 — override d'édition inatteignable | Résolu | La règle d'édition directe ne présente plus un override inexécutable. Les contenus inspectés ne peuvent pas injecter un marqueur de contournement. | Cas de politique dédié dans les tests du cœur et dans la vérification du runtime. |
| L3 — faux positifs d'écriture shell | Résolu | La détection utilise la commande parsée au lieu de rechercher des mots dans tout le texte. `/dev/null`, `nul`, `$null` et les duplications de descripteur comme `2>&1` ne sont plus considérés comme des fichiers écrits. | Table POSIX/PowerShell couvrant lectures, redirections réelles et faux positifs historiques. |
| L4 — absence de tests | Résolu | Des tests directs couvrent désormais `isShellFileWrite`, `isDirectEditTool`, l'extraction des chemins et leur intégration dans le garde. | Suite de politique : 102 scénarios réussis. Suite du cœur : 45 réussis, 1 test de symlink ignoré faute de privilège Windows. |
| L5 — politique locale silencieusement absente | Résolu | Le parcours interactif demande explicitement si l'utilisateur souhaite le module `git-policy`, en précisant qu'il fournit un retour local contournable et que la CI/GitHub reste l'autorité partagée. Une ancienne installation détectée mais non sélectionnée produit une recommandation de migration. | Test du choix interactif et du plan résultant. |
| L6 — discours de sécurité incohérent | Résolu | Les messages et la documentation présentent uniformément les hooks locaux comme défense en profondeur. La CI et les règles de la forge portent l'autorité partagée ; aucun hook local n'est présenté comme une frontière de sécurité. | Vérification documentaire et scénarios de politique. |
| L7 — dérive de versions | Résolu | La version du runtime est alignée sur celle du paquet (`3.0.0-alpha.1`). Le démarrage de session compare le runtime installé à la CLI disponible et signale une dérive sans bloquer. | Test d'égalité paquet/runtime et validation de l'archive npm réelle. |
| L8 — push de clôture impossible | Résolu dans le runtime courant | Les anciennes limites de taille/âge de lot ne bloquent plus le push d'une branche courte vers son propre remote. Le comportement praticable est verrouillé par un test du hook Git natif. | Test de `pre-push` sur une branche courte propre au contributeur. |
| L9 — boucle du hook d'arrêt | Résolu | Le hook `Stop` est désormais uniquement consultatif et retourne toujours un succès ; il ne peut plus emprisonner l'agent dans une boucle sans issue. | Test d'exécution du hook avec un état Git nécessitant une attention. |
| L10 — matcher Claude incomplet | Résolu | Le matcher `PreToolUse` est `*`, de sorte que les outils actuels et futurs passent par le garde sans maintenir une liste de shells. | Test structurel du modèle Claude et test d'intégration du garde. |

## Validation sur projets réels isolés

Les sources `D:\Fleury\Projects\steve` et
`D:\Fleury\Projects\hermes-agent` ont été copiées dans un dossier temporaire
sous `D:\Fleury\Projects\_sentinel-tests`. Le copieur exclut Git, les
dépendances, les sorties de construction, les clés, les fichiers d'environnement
non exemples, les fichiers d'authentification usuels et tout fichier détecté
comme contenant une valeur secrète.

| Projet copié | Détection | Plan local | Résultat |
| --- | --- | ---: | --- |
| Steve | JavaScript/TypeScript, pnpm, monorepo | 16 actions : 12 R1, 4 R2 | Application réussie, second plan vide, restauration octet-exacte |
| Hermes Agent | Python, dépôt simple | 20 actions : 17 R1, 3 R2 | Application réussie, second plan vide, restauration octet-exacte |

Les commits et les empreintes des états Git des deux projets sources sont
strictement identiques avant et après le test. Le répertoire temporaire créé
pour cette exécution a été supprimé ; les anciens essais déjà présents dans
`_sentinel-tests` ont été conservés.

## Contrôles exécutés

- vérification de la politique : 102 réussites, 0 échec ;
- tests du cœur : 45 réussites, 0 échec, 1 test de symlink ignoré par Windows ;
- sept évaluations structurellement valides ;
- archive npm réelle `gitflow-sentinel-3.0.0-alpha.1.tgz` installée et testée ;
- auto-hébergement : plan brownfield, idempotence, rollback et désinstallation
  octet-exacts validés ;
- matrice Steve/Hermes : réussie sans mutation des dépôts sources.

La vérification distante GitHub n'est pas revendiquée ici : aucun changement
GitHub, push ou publication npm n'a été exécuté pendant cette résolution.
