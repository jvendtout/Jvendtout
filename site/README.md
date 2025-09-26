# JVendTout - Site de Vente E-commerce

## 📋 Description

Site de vente e-commerce moderne avec interface d'administration pour la gestion des produits. Développé avec Node.js/Express et vanilla JavaScript, il offre une expérience utilisateur fluide avec un système de panier, filtres, et gestion complète des articles.

## 🚀 Fonctionnalités

### Interface Utilisateur
- **Boutique en ligne** : Affichage des produits avec filtres par catégorie et prix
- **Panier d'achat** : Ajout/suppression d'articles, calcul automatique des totaux
- **Système de modales** : Interface intuitive pour les détails produits
- **Responsive design** : Compatible mobile et desktop
- **Système d'avis** : Les clients peuvent laisser des avis avec médias

### Interface Administration
- **Gestion des produits** : Ajout, modification, suppression d'articles
- **Explorateur de médias** : Navigation dans l'arborescence des images/vidéos
- **Gestion des catégories** : Organisation des produits par catégories
- **Aperçu en temps réel** : Prévisualisation des médias avant sélection

### Fonctionnalités Avancées
- **Système d'arnaques** : Signalement et gestion des fraudes
- **Gestion des offres** : Promotions et offres spéciales
- **Archivage des avis** : Système de modération des commentaires
- **API REST complète** : Endpoints pour toutes les opérations CRUD

## 🛠️ Technologies

- **Backend** : Node.js, Express.js
- **Frontend** : HTML5, CSS3, JavaScript (Vanilla)
- **Base de données** : Fichiers JSON (articles.json, categories.json, etc.)
- **Upload de fichiers** : Multer
- **Serveur de médias** : Serveur statique Express

## 📦 Installation

### Prérequis
- Node.js (version 14 ou supérieure)
- npm ou yarn

### Installation locale
```bash
# Cloner le repository
git clone https://github.com/[votre-username]/jvendtout.git
cd jvendtout

# Installer les dépendances
npm install

# Lancer le serveur de développement
npm start
```

Le site sera accessible sur : `http://localhost:3000`

## 🔧 Structure du Projet

```
├── Site/
│   ├── server.js              # Serveur Node.js/Express
│   ├── index.html             # Page principale de la boutique
│   ├── admin.html             # Interface d'administration
│   ├── articles.json          # Base de données des produits
│   ├── categories.json        # Catégories des produits
│   ├── img/                   # Dossier des médias
│   │   ├── Artifices/         # Images feux d'artifice
│   │   ├── Electronique/      # Images électronique
│   │   └── ...
│   └── autres fichiers JSON   # Arnaques, offres, avis, etc.
├── package.json               # Configuration npm
├── .gitignore                 # Fichiers ignorés par Git
└── README.md                  # Documentation
```

## 🌐 Déploiement

### Déploiement sur Render
1. Connectez votre repository GitHub à Render
2. Configurez les variables d'environnement si nécessaire
3. Le déploiement se fait automatiquement

### Déploiement sur Railway
1. Connectez votre compte GitHub à Railway
2. Sélectionnez ce repository
3. Railway détectera automatiquement la configuration

### Déploiement sur Heroku
```bash
# Installer Heroku CLI et se connecter
heroku login

# Créer une nouvelle app
heroku create votre-nom-app

# Déployer
git push heroku main
```

## ⚙️ Configuration

### Variables d'environnement
- `PORT` : Port du serveur (défaut: 3000)
- `NODE_ENV` : Environnement (production/development)

### Fichiers de configuration
- Les données sont stockées dans des fichiers JSON dans le dossier `Site/`
- Les médias sont organisés dans `Site/img/` par catégories

## 📱 Utilisation

### Interface Boutique (`/index.html`)
1. Parcourir les produits par catégories
2. Utiliser les filtres de prix et de recherche
3. Ajouter des articles au panier
4. Finaliser la commande

### Interface Admin (`/admin.html`)
1. Se connecter à l'interface d'administration
2. Ajouter/modifier des produits
3. Gérer les catégories
4. Explorer et sélectionner des médias

## 🔄 API Endpoints

### Articles
- `GET /api/articles` - Récupérer tous les articles
- `POST /api/articles` - Ajouter un article
- `PUT /api/articles/:id` - Modifier un article
- `DELETE /api/articles/:id` - Supprimer un article

### Catégories
- `GET /api/categories` - Récupérer les catégories
- `PUT /api/categories` - Mettre à jour les catégories

### Médias
- `GET /api/explorer?path=` - Explorer les fichiers médias

## 🤝 Contribution

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

Ce projet est sous licence ISC. Voir le fichier `LICENSE` pour plus de détails.

## 📞 Support

Pour toute question ou problème :
- Ouvrir une issue sur GitHub
- Contacter l'équipe de développement

## 🔄 Changelog

### Version 1.0.0
- Interface de boutique complète
- Système d'administration
- API REST
- Gestion des médias
- Système de panier
- Responsive design

---

Développé avec ❤️ pour une expérience e-commerce moderne et intuitive.