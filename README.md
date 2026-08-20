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
