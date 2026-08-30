# Gestion Budget 💶

Application privée de gestion de budget familial, mois par mois. Inspirée d'un
suivi Excel/Google Sheets existant : revenus, dépenses fixes/courantes/occasionnelles,
épargne, et une allocation journalière calculée automatiquement.

Live à [hbdevelop.github.io/gestion-budget](https://hbdevelop.github.io/gestion-budget/).

## Structure

- `index.html` / `style.css` — la page
- `app.js` — logique (auth, chargement/sauvegarde des mois, calculs)
- `firebase-config.js` — config publique du projet Firebase + liste des emails autorisés

## Sécurité

L'app est servie publiquement sur GitHub Pages, mais les **données** ne le sont pas :

- Connexion obligatoire via **Google Sign-In** (Firebase Authentication)
- Les **règles de sécurité Firestore** n'autorisent la lecture/écriture qu'aux
  comptes Google listés dans `AUTHORIZED_EMAILS` (`firebase-config.js`). Toute
  autre personne connectée avec un autre compte Google se voit refuser l'accès,
  même si elle trouve l'URL.

Pour ajouter/retirer une personne autorisée :
1. Modifier `AUTHORIZED_EMAILS` dans `firebase-config.js`
2. Mettre à jour la même liste dans les règles Firestore (console Firebase du
   projet `gestion-budget-3a2f5` → Firestore Database → Règles)

## Données

Chaque mois est un document Firestore (`months/AAAA-MM`) contenant les revenus,
les dépenses (groupées par catégorie, avec statut payé/non payé) et l'épargne.
Un nouveau mois peut être créé en dupliquant le mois précédent (montants et
libellés repris, cases "payé" réinitialisées).

## Espaces (Commun / Habib / Marwa / Famille)

Chaque poste du catalogue porte un champ `owner` (`commun`, `habib` ou `marwa`,
définis dans `SPACES` de `firebase-config.js`). Le sélecteur d'espace en haut de
l'app filtre toutes les vues :

- **Commun / Habib / Marwa** — uniquement les postes de cet espace, avec son
  propre solde bancaire et sa propre allocation journalière.
- **Famille** — vue consolidée : cartes résumé ventilées par personne, tableau
  temps réel par espace, un bloc par personne, et graphes de répartition dédiés.

Le solde bancaire du mois est stocké par espace :
`months/AAAA-MM.bankBalances` = `{ commun, habib, marwa }`. L'ancien format
(`bankBalance`, un seul nombre) est lu comme « tout sur le compte commun » et
converti au premier enregistrement.

Un poste marqué `internal: true` (virement entre espaces, ex. « Virement →
commun ») est compté normalement dans son espace mais **neutralisé dans le
consolidé**, pour ne pas compter deux fois l'argent qui circule dans le foyer.

Migration : les postes sans `owner` sont rattachés à `commun` au chargement
(`normalizeCatalogOwners`). Les règles Firestore sont inchangées.

## Développement local

Comme il s'agit de modules JS natifs (`type="module"`), il faut servir les
fichiers via un petit serveur HTTP (pas de `file://`) :

```bash
python -m http.server 8080
```

Puis ouvrir `http://localhost:8080`. `localhost` est déjà autorisé côté
Firebase Auth.

## Déploiement

GitHub Pages sert directement les fichiers statiques depuis la branche
`release`. Un `git push` suffit, le site se met à jour automatiquement.
