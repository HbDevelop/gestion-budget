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

## Espaces (Habib / Marwa / Famille)

Un espace par personne. Chaque poste du catalogue porte un champ `owner`
(`habib` ou `marwa`, définis dans `SPACES` de `firebase-config.js`). Le sélecteur
d'espace en haut de l'app filtre toutes les vues :

- **Habib / Marwa** — uniquement les postes de cette personne, avec son propre
  solde bancaire et sa propre allocation journalière.
- **Famille** — vue consolidée : cartes résumé ventilées par personne, tableau
  temps réel par espace, un bloc par personne, et graphes de répartition dédiés.

Une charge partagée (loyer, courses…) est simplement attribuée à la personne qui
la paie ; si on veut la voir répartie, on crée deux postes (une part par
personne).

Le solde bancaire du mois est stocké par espace :
`months/AAAA-MM.bankBalances` = `{ habib, marwa }`. L'ancien format
(`bankBalance`, un seul nombre) est rattaché à l'espace de repli et converti au
premier enregistrement.

Un poste marqué `internal: true` (transfert entre les deux, ex. un remboursement)
est compté normalement dans chaque espace mais **neutralisé dans le consolidé**,
pour ne pas compter deux fois l'argent qui circule dans le foyer.

### Reprise / migration

- Les postes sans `owner` (ou avec un ancien `owner: "commun"`) sont rattachés à
  l'espace de repli (`OWNER_KEYS[0]`) au chargement (`normalizeCatalogOwners`).
- L'écran **Prévisions** a une barre « Attribuer les N postes à `<espace>` » :
  en scope **Famille** elle réaffecte tout le catalogue en un clic, avec une
  option pour déplacer aussi le solde bancaire de chaque mois. On répartit
  ensuite au cas par cas via le menu déroulant de chaque ligne.
- Les règles Firestore sont inchangées.

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
