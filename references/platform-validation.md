# Validation Windows, Linux et macOS

## État vérifié

- Windows natif : le paquet réel, le bootstrap global, le cycle transactionnel
  et les essais brownfield sur Steve ont été exécutés localement.
- WSL/Linux : WSL n'est pas encore installé sur la machine de test.
- macOS : la matrice CI est prête, mais le résultat de cette branche ne peut pas
  être déclaré tant qu'elle n'a pas été poussée et exécutée par GitHub Actions.

WSL n'est pas requis pour utiliser Sentinel sous Windows. Il fournit une
validation Linux réelle sur la même machine et contourne aussi la limitation
observée du bac à sable Codex sous Windows.

## Installer WSL

Ouvrir PowerShell **en tant qu'administrateur**, puis exécuter :

```powershell
wsl --install
```

Redémarrer Windows si demandé. Au premier lancement d'Ubuntu, créer le nom
d'utilisateur et le mot de passe Linux. La procédure officielle Microsoft est
documentée sur
[Installer WSL](https://learn.microsoft.com/windows/wsl/install).

Cette installation demande une élévation administrateur et peut redémarrer la
machine ; Sentinel ne la déclenche donc jamais automatiquement.

## Rejouer le contrôle Linux

Après le redémarrage, ouvrir Ubuntu puis installer une version Node prise en
charge et Git. Depuis une copie Linux du dépôt :

```bash
npm install --ignore-scripts
npm run verify
npm run validate:evals
npm run validate:package
```

Le test doit aussi exécuter `npm run bootstrap` avec un dossier utilisateur et
un préfixe npm isolés, puis vérifier le même cycle
`plan -> apply -> verify -> rollback`.

## Contrôle macOS

Le workflow `.github/workflows/ci.yml` exécute déjà la même suite sur :

- Ubuntu, Windows et macOS ;
- Node.js 18 et 22 ;
- l'archive npm réelle et son bootstrap isolé.

La compatibilité macOS sera considérée comme vérifiée seulement lorsque les
deux jobs macOS de cette branche seront verts. Les runners GitHub hébergés
fournissent des machines virtuelles neuves pour chaque job ; voir la
[documentation GitHub sur les runners hébergés](https://docs.github.com/actions/concepts/runners/github-hosted-runners).
