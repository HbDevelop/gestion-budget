// Config du projet Firebase "gestion-budget" (console.firebase.google.com).
// Ces clés sont publiques par design (elles identifient juste le projet, elles n'autorisent
// rien en elles-mêmes). L'AUTORISATION est faite uniquement côté serveur, par les règles
// de sécurité Firestore (console Firebase du projet gestion-budget-3a2f5) : elles limitent
// lecture ET écriture aux comptes Google autorisés. Aucun email ne figure dans ce dépôt —
// si un autre compte se connecte, l'app se charge mais toute requête est refusée par les
// règles, et l'écran "accès refusé" s'affiche sur l'erreur.
export const firebaseConfig = {
  apiKey: "AIzaSyCcZ_Q8YHCWR7vYH6wcOrLgDR4pc7rFsAU",
  authDomain: "gestion-budget-3a2f5.firebaseapp.com",
  projectId: "gestion-budget-3a2f5",
  storageBucket: "gestion-budget-3a2f5.firebasestorage.app",
  messagingSenderId: "424863797938",
  appId: "1:424863797938:web:658cab417285ae7f686fab"
};

// Espaces budgétaires du foyer : un par personne. Chaque poste du catalogue porte un
// `owner` qui vaut l'une de ces clés. La vue "Famille" consolide les espaces.
// Pour ajouter une personne : ajouter une entrée ici (+ une couleur dans OWNER_COLOR
// de app.js si on veut autre chose que la palette par défaut) ET dans les règles Firestore.
export const SPACES = [
  { key: "habib", label: "Habib" },
  { key: "marwa", label: "Marwa" }
];

// ID client OAuth Web du provider Google (Firebase Auth > Sign-in method > Google >
// Configuration du SDK Web). Utilisé par Google Identity Services pour la connexion :
// on évite ainsi le relais par iframe tierce de Firebase (gestion-budget-3a2f5.firebaseapp.com),
// souvent bloqué par les navigateurs qui restreignent le stockage/cookies tiers.
export const GOOGLE_CLIENT_ID = "424863797938-jthv0vqgobm6php72mpiuuqqh11b2a8q.apps.googleusercontent.com";
