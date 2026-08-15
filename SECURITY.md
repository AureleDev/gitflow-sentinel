# Politique de sécurité

## Versions prises en charge

Gitflow Sentinel est encore en alpha. Seule la préversion actuellement publiée
sous le dist-tag npm `next` reçoit les correctifs de sécurité. Les anciennes
alphas peuvent servir de preuve historique, mais ne sont pas maintenues.

## Signaler une vulnérabilité

N'ouvrez pas d'issue publique et ne publiez pas de démonstration exploitable.

Utilisez en priorité le signalement privé de vulnérabilité GitHub lorsqu'il est
disponible dans l'onglet **Security** du dépôt. S'il n'est pas disponible,
contactez le mainteneur depuis le profil GitHub
[@AureleDev](https://github.com/AureleDev) avec un message minimal demandant un
canal privé. N'envoyez pas de détail sensible dans un canal public.

Le rapport privé devrait contenir :

- la version concernée et le système utilisé ;
- l'impact observé ou plausible ;
- des étapes de reproduction minimales dans un projet jetable ;
- toute condition préalable importante ;
- une proposition de correction, si vous en avez une.

N'incluez jamais de véritables identifiants, jetons, données personnelles,
contenus clients ou dépôts privés. Remplacez-les par des valeurs fictives.

## Traitement

Le mainteneur accuse réception, confirme la portée, prépare et vérifie le
correctif, puis coordonne la divulgation après qu'une version corrigée est
disponible. Aucun délai contractuel n'est garanti pendant l'alpha, mais les
signalements exploitables et responsables sont prioritaires.

## Périmètre de confiance

Les hooks d'agent et les hooks Git locaux peuvent être contournés par un
processus qui contrôle la machine. Ils réduisent les erreurs accidentelles mais
ne constituent pas une frontière de sécurité. L'autorité partagée appartient à
la CI requise et aux règles vérifiées de la forge distante.

Sentinel considère les fichiers du projet comme des données non fiables. Toute
exécution d'une commande découverte, mutation distante, publication ou action
sur un secret doit rester explicitement approuvée.
