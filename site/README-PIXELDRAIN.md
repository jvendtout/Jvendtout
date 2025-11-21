# 🎨 Explorateur Pixeldrain - Documentation

## 📋 Vue d'ensemble

Ce projet intègre **Pixeldrain** comme solution de stockage pour les médias de votre site, permettant de contourner les limitations de stockage de GitHub. L'explorateur de fichiers virtuel vous permet de gérer et sélectionner dynamiquement vos médias hébergés sur Pixeldrain.

## 🚀 Installation et Démarrage

### Prérequis
- Node.js 18+ 
- Compte Pixeldrain avec clé API
- Variables d'environnement configurées

### Installation
```bash
npm install
```

### Configuration
Définir la variable d'environnement sur Render :
```
PIXELDRAIN_API_KEY=votre_cle_api_pixeldrain
```

### Démarrage
```bash
# Production
npm start

# Développement  
npm run dev
```

## 🏗️ Architecture

### Backend (`/Site/server.js`)
- **Express 5.x** avec CORS activé
- **Route `/images`** : API sécurisée pour récupérer les fichiers Pixeldrain
- **Authentification** : Clé API stockée côté serveur uniquement
- **Compatible Render** : Utilise `process.env.PORT`

### Frontend (`/Site/public/`)
- **Interface moderne** : Explorateur de fichiers intuitif
- **Sélection multiple** : Système de sélection avec feedback visuel
- **Filtres avancés** : Par type (images/vidéos) et recherche textuelle
- **Responsive design** : Optimisé mobile et desktop

## 🎯 Fonctionnalités

### Explorateur de Fichiers
- ✅ **Chargement dynamique** depuis Pixeldrain API
- ✅ **Aperçu automatique** des images et vidéos  
- ✅ **Sélection multiple** avec compteur en temps réel
- ✅ **Filtrage** par type de fichier
- ✅ **Recherche** en temps réel
- ✅ **Actualisation automatique** toutes les 5 minutes
- ✅ **Raccourcis clavier** (Ctrl+A, Ctrl+D, Ctrl+F, Ctrl+R)

### Sécurité
- 🔒 **Clé API jamais exposée** côté client
- 🔒 **Gestion d'erreurs** robuste
- 🔒 **CORS configuré** pour sécuriser les requêtes

## 🛠️ API Endpoints

### `GET /images`
Récupère la liste des fichiers depuis Pixeldrain
```json
[
  {
    "name": "image.jpg",
    "url": "https://pixeldrain.com/api/file/abc123",
    "id": "abc123", 
    "size": 1024000,
    "date_upload": "2025-10-03T10:00:00Z"
  }
]
```

## 🎨 Interface Utilisateur

### Navigation
- **Recherche** : Barre de recherche en temps réel
- **Filtres** : Tous / Images / Vidéos / Autres
- **Actualisation** : Bouton de rechargement manuel
- **Statistiques** : Compteurs de fichiers totaux/sélectionnés/affichés

### Sélection
- **Clic simple** : Sélectionner/désélectionner un fichier
- **Indicateur visuel** : Bordure bleue + checkmark
- **Panel flottant** : Affichage du nombre de sélections
- **Désélection rapide** : Bouton "Tout désélectionner"

## 🔧 Intégration avec le Site Principal

### API JavaScript Global
```javascript
// Récupérer les fichiers sélectionnés
const selectedFiles = window.getSelectedPixeldrainFiles();

// Récupérer uniquement les URLs
const selectedUrls = window.getSelectedPixeldrainUrls();

// Accès à l'explorateur complet
const explorer = window.pixeldrainExplorer;
```

### Utilisation dans d'autres scripts
```javascript
// Vérifier si des fichiers sont sélectionnés
if (window.pixeldrainExplorer.selectedFiles.size > 0) {
    const files = window.getSelectedPixeldrainFiles();
    // Traiter les fichiers sélectionnés
}
```

## 🚀 Déploiement sur Render

### Variables d'environnement requises
```
PIXELDRAIN_API_KEY=your_pixeldrain_api_key
PORT=3000  # Géré automatiquement par Render
```

### Configuration Render
1. **Build Command** : `npm install`
2. **Start Command** : `npm start`
3. **Environment** : Node.js
4. **Auto-Deploy** : Activé sur push GitHub

## 📁 Structure des Fichiers

```
Site/
├── server.js              # Backend Express avec route Pixeldrain
├── public/                 # Frontend statique
│   ├── index.html         # Interface explorateur
│   └── main.js            # Logique JavaScript
├── package.json           # Dépendances et scripts
└── README-PIXELDRAIN.md   # Cette documentation
```

## 🔄 Workflow d'Utilisation

1. **Démarrer le serveur** : `npm start`
2. **Accéder à l'explorateur** : `http://localhost:3000/`
3. **Parcourir les fichiers** Pixeldrain automatiquement chargés
4. **Filtrer/Rechercher** selon vos besoins
5. **Sélectionner les médias** pour votre article
6. **Intégrer dans votre site** via les APIs JavaScript

## 🐛 Dépannage

### Erreur "Clé API non configurée"
- Vérifiez que `PIXELDRAIN_API_KEY` est définie
- Redémarrez le serveur après modification

### Aucun fichier affiché
- Vérifiez votre connexion internet
- Validez la clé API Pixeldrain
- Consultez les logs serveur pour plus de détails

### Erreurs CORS
- Vérifiez que `cors` est installé : `npm install`
- Assurez-vous que `app.use(cors())` est présent dans server.js

## 📈 Évolutions Futures

- [ ] Upload direct vers Pixeldrain depuis l'interface
- [ ] Gestion des dossiers/albums
- [ ] Prévisualisation plein écran
- [ ] Métadonnées étendues (EXIF pour images)
- [ ] Cache local pour améliorer les performances
- [ ] Synchronisation bidirectionnelle

---

**🎉 Votre solution de stockage illimité est maintenant opérationnelle !**