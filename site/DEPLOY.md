# 🚀 Guide de Déploiement - JVendTout

Ce guide vous explique comment déployer votre site JVendTout sur différentes plateformes d'hébergement.

## 📋 Prérequis

Avant de déployer, assurez-vous que :
- Votre code est sur GitHub
- Tous les fichiers sont commités
- Le `package.json` est correctement configuré
- Le `.gitignore` exclut les fichiers sensibles

## 🌐 Options de Déploiement

### 1. 🔥 Render (Recommandé)

**Avantages :** Gratuit, facile, support Node.js natif, SSL automatique

#### Étapes de déploiement :

1. **Créer un compte sur [Render](https://render.com)**

2. **Connecter votre repository GitHub :**
   - Cliquez sur "New +" → "Web Service"
   - Connectez votre compte GitHub
   - Sélectionnez votre repository `jvendtout`

3. **Configuration du service :**
   ```
   Name: jvendtout
   Environment: Node
   Build Command: npm install
   Start Command: npm start
   ```

4. **Variables d'environnement (optionnel) :**
   ```
   NODE_ENV=production
   PORT=10000
   ```

5. **Déployer :**
   - Cliquez sur "Create Web Service"
   - Render détectera automatiquement votre `package.json`
   - Le déploiement prend 2-5 minutes

#### URL finale :
`https://votre-app-name.onrender.com`

---

### 2. 🚂 Railway

**Avantages :** Interface simple, déploiement automatique, domaine personnalisé

#### Étapes de déploiement :

1. **Se connecter sur [Railway](https://railway.app)**

2. **Nouveau projet :**
   - "New Project" → "Deploy from GitHub repo"
   - Sélectionnez votre repository

3. **Configuration automatique :**
   - Railway détecte automatiquement Node.js
   - Utilise `npm start` par défaut

4. **Variables d'environnement :**
   ```
   NODE_ENV=production
   ```

5. **Domaine personnalisé (optionnel) :**
   - Onglet "Settings" → "Domains"
   - Générer un domaine Railway ou ajouter le vôtre

---

### 3. 🔷 Heroku

**Avantages :** Très populaire, nombreux add-ons, scaling facile

#### Étapes de déploiement :

1. **Installation d'Heroku CLI :**
   ```bash
   # Windows (avec chocolatey)
   choco install heroku-cli
   
   # macOS (avec homebrew)
   brew tap heroku/brew && brew install heroku
   
   # Linux
   curl https://cli-assets.heroku.com/install.sh | sh
   ```

2. **Connexion et création de l'app :**
   ```bash
   heroku login
   heroku create votre-nom-app
   ```

3. **Configuration des variables :**
   ```bash
   heroku config:set NODE_ENV=production
   ```

4. **Déploiement :**
   ```bash
   git push heroku main
   ```

#### URL finale :
`https://votre-nom-app.herokuapp.com`

---

### 4. ⚡ Vercel (Pour sites statiques + API)

**Note :** Convient mieux aux sites avec API serverless

1. **Installation de Vercel CLI :**
   ```bash
   npm i -g vercel
   ```

2. **Configuration `vercel.json` :**
   ```json
   {
     "version": 2,
     "builds": [
       {
         "src": "Site/server.js",
         "use": "@vercel/node"
       }
     ],
     "routes": [
       {
         "src": "/(.*)",
         "dest": "Site/server.js"
       }
     ]
   }
   ```

3. **Déploiement :**
   ```bash
   vercel --prod
   ```

---

## 🔧 Configuration Post-Déploiement

### 1. Vérification du fonctionnement
Testez ces URLs après déploiement :
- `/` ou `/index.html` - Page principale
- `/admin.html` - Interface admin
- `/api/articles` - API des articles

### 2. Domaine personnalisé
La plupart des plateformes permettent d'ajouter un domaine personnalisé :
- Render : Settings → Custom Domains
- Railway : Settings → Domains
- Heroku : Settings → Domains

### 3. SSL/HTTPS
Toutes ces plateformes fournissent SSL gratuit automatiquement.

## 🐛 Résolution de Problèmes

### Erreur de port
Si vous obtenez une erreur de port, assurez-vous que votre `server.js` utilise :
```javascript
const PORT = process.env.PORT || 3000;
```

### Fichiers manquants
Vérifiez que tous vos fichiers sont bien commités :
```bash
git status
git add .
git commit -m "Prêt pour le déploiement"
git push origin main
```

### Dépendances manquantes
Assurez-vous que toutes les dépendances sont dans `dependencies` (pas `devDependencies`) :
```bash
npm install --save express multer body-parser
```

## 📊 Monitoring et Logs

### Render
- Logs en temps réel dans le dashboard
- Métriques de performance intégrées

### Railway
- Logs accessibles via le dashboard
- Alertes automatiques en cas d'erreur

### Heroku
```bash
heroku logs --tail -a votre-app-name
```

## 🔄 Mises à jour

Pour tous les services, les mises à jour se font automatiquement :
1. Commitez vos changements sur GitHub
2. Poussez vers la branche `main`
3. Le déploiement se fait automatiquement

```bash
git add .
git commit -m "Mise à jour du site"
git push origin main
```

## 💡 Conseils Bonus

1. **Utilisez des branches** pour tester avant de déployer en production
2. **Configurez des alertes** pour surveiller votre site
3. **Sauvegardez régulièrement** vos fichiers JSON
4. **Testez localement** avant chaque déploiement

---

# Déploiement sur Render

1. Commit & push (package.json à la racine).
2. Render -> New -> Web Service.
3. Sélectionner repo.
4. Environment: Node
5. Root Directory: (laisser vide)
6. Build Command: npm install
7. Start Command: npm start
8. Créer.

Tester:
- /index.html
- /admin.html
- /api/articles
- /healthz

Limite plan gratuit: fichiers JSON modifiés perdus lors d’un REBUILD (pas entre simples redémarrages). Pour persistance durable => base de données plus tard.

---

**Félicitations ! 🎉** Votre site JVendTout est maintenant en ligne et accessible au monde entier !