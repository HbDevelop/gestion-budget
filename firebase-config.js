// Config du projet Firebase "gestion-budget" (console.firebase.google.com).
// Ces clés sont publiques par design (elles identifient juste le projet, elles n'autorisent rien
// en elles-mêmes) : la vraie sécurité vient des règles Firestore (voir README.md) qui limitent
// la lecture/écriture aux deux comptes Google autorisés ci-dessous.
export const firebaseConfig = {
  apiKey: "AIzaSyCcZ_Q8YHCWR7vYH6wcOrLgDR4pc7rFsAU",
  authDomain: "gestion-budget-3a2f5.firebaseapp.com",
  projectId: "gestion-budget-3a2f5",
  storageBucket: "gestion-budget-3a2f5.firebasestorage.app",
  messagingSenderId: "424863797938",
  appId: "1:424863797938:web:658cab417285ae7f686fab"
};

// Doit rester identique aux emails autorisés dans les règles Firestore.
export const AUTHORIZED_EMAILS = [
  "boudriga.habib@gmail.com",
  "elghoulmarwaem@gmail.com"
];

// Espaces budgétaires du foyer. Chaque poste du catalogue porte un `owner` qui vaut
// l'une de ces clés. "commun" = le pot commun (loyer, courses…), les autres = le budget
// perso de chacun. La vue "Famille" consolide les trois. `email` sert juste à
// pré-sélectionner le bon espace à la connexion — ça ne restreint rien (chaque compte
// autorisé peut voir et éditer tous les espaces).
export const SPACES = [
  { key: "commun", label: "Commun" },
  { key: "habib",  label: "Habib", email: "boudriga.habib@gmail.com" },
  { key: "marwa",  label: "Marwa", email: "elghoulmarwaem@gmail.com" }
];

// ID client OAuth Web du provider Google (Firebase Auth > Sign-in method > Google >
// Configuration du SDK Web). Utilisé par Google Identity Services pour la connexion :
// on évite ainsi le relais par iframe tierce de Firebase (gestion-budget-3a2f5.firebaseapp.com),
// souvent bloqué par les navigateurs qui restreignent le stockage/cookies tiers.
export const GOOGLE_CLIENT_ID = "424863797938-jthv0vqgobm6php72mpiuuqqh11b2a8q.apps.googleusercontent.com";
