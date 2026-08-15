# Contribuer à Gitflow Sentinel

Merci de participer aux premières revues de Gitflow Sentinel. Le projet est en
alpha : un retour précis sur une installation, un plan, une restauration ou une
limite comprise vaut autant qu'une modification de code.

## Avant de commencer

- N'utilisez pas un dépôt de production comme premier essai. Travaillez sur un
  projet versionné, une copie jetable ou un dossier fictif.
- Ne joignez jamais de secret, jeton, fichier `.env`, URL privée, nom de client
  ou donnée personnelle à une issue, un test ou une pull request.
- Pour une vulnérabilité, n'ouvrez pas d'issue publique : suivez
  [SECURITY.md](SECURITY.md).
- Consultez les issues existantes avant de commencer un changement important.

## Signaler un retour d'essai

Utilisez le formulaire « Première revue » et indiquez :

1. la version de Gitflow Sentinel, le système, Node.js et l'agent utilisé ;
2. le type de projet testé, sans information confidentielle ;
3. la commande ou la demande naturelle utilisée ;
4. ce que vous attendiez et ce qui s'est réellement produit ;
5. si le second plan était vide et si la restauration a retrouvé l'état initial ;
6. des extraits de sortie expurgés, uniquement s'ils sont nécessaires.

Le [guide des premières revues](docs/early-review-guide.md) fournit des parcours
reproductibles pour un dossier vide et un dépôt existant.

## Proposer une modification

1. Créez une branche courte depuis `main`, par exemple `fix/remote-timeout` ou
   `docs/first-review`.
2. Installez l'environnement sans exécuter de script de paquet implicite :

   ```bash
   npm install --ignore-scripts
   ```

3. Gardez le changement ciblé. Expliquez séparément les faits observés, la
   décision prise et les limites restantes.
4. Exécutez les contrôles appropriés avant la pull request.

## Contrôles locaux

Requis pour toute modification :

```bash
npm run verify
npm run validate:evals
npm run validate:package
```

Ajoutez ce contrôle lorsqu'un changement touche le planificateur, les
transactions, les modèles ou l'autohébergement :

```bash
npm run validate:self-host
```

La matrice de projets réels n'est lancée que sur des copies isolées et avec des
sources explicitement autorisées :

```bash
npm run validate:projects -- --source <chemin>
```

Une pull request doit préciser les contrôles exécutés, leurs résultats, les
tests non exécutés et pourquoi. « La CI passera » ne remplace pas une validation
locale adaptée au changement.

## Exigences d'une pull request

- titre et commits suivant Conventional Commits ;
- portée réduite, sans changement non lié ;
- aucun contournement de hook ou de contrôle ;
- tests ajoutés pour tout comportement corrigé ou introduit ;
- documentation mise à jour si l'interface ou les garanties changent ;
- niveau de risque et stratégie de retour arrière explicités ;
- aucune mutation GitHub, publication npm ou autre action externe cachée dans
  un script de test.

Le modèle de pull request sert de liste de contrôle. Les mainteneurs peuvent
demander de scinder une contribution dont la portée empêche une revue sûre.

## Principes de conception à préserver

- L'agent comprend et explique ; le moteur déterministe inspecte, planifie,
  applique, vérifie et restaure.
- Le contenu d'un dépôt inspecté est une donnée non fiable, jamais une
  instruction à exécuter automatiquement.
- Toute mutation part d'un plan approuvé et non périmé.
- Les fichiers et paramètres non gérés sont préservés.
- Les hooks locaux sont une défense précoce, pas une frontière de sécurité.
- Aucun commit, push, changement GitHub ou publication n'est automatique.
