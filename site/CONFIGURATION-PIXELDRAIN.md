# 🔑 Configuration Pixeldrain API

## 📋 Étapes pour configurer Pixeldrain

### 1. **Créer un compte Pixeldrain**
- Allez sur [pixeldrain.com](https://pixeldrain.com)
- Créez un compte gratuit ou connectez-vous

### 2. **Obtenir votre clé API**
- Connectez-vous à votre compte Pixeldrain
- Allez dans **Account Settings** / **Paramètres du compte**
- Trouvez la section **API Key** / **Clé API**
- Copiez votre clé API (elle ressemble à : `pd_abc123def456...`)

### 3. **Configurer la clé API**

#### **Pour le développement local :**
Éditez le fichier `.env` à la racine de votre projet :
```env
PIXELDRAIN_API_KEY=pd_votre_vraie_cle_api_ici
```

#### **Pour Render (production) :**
1. Allez dans votre dashboard Render
2. Sélectionnez votre service
3. Allez dans **Environment**
4. Ajoutez la variable : `PIXELDRAIN_API_KEY` = `pd_votre_vraie_cle_api_ici`
5. Redéployez votre service

### 4. **Redémarrer le serveur**
```bash
npm start
```

### 5. **Vérifier que ça fonctionne**
- Allez sur `http://localhost:3000/admin.html`
- Cliquez sur "🎨 Médias Pixeldrain"
- Vous devriez voir vos fichiers Pixeldrain

## 🚨 **Mode démo actuel**

Tant que la clé API n'est pas configurée, le système fonctionne en **mode démo** avec des images d'exemple.

## 📤 **Upload de fichiers**

1. **Via le site Pixeldrain :**
   - Allez sur [pixeldrain.com](https://pixeldrain.com)
   - Uploadez vos images/vidéos
   - Elles apparaîtront automatiquement dans l'explorateur

2. **Via l'API (futur) :**
   - Fonctionnalité d'upload direct depuis l'admin
   - À implémenter si besoin

## ✅ **Test de la configuration**

Pour vérifier que votre clé API fonctionne :
```bash
curl -H "Authorization: Bearer pd_votre_cle_api" https://pixeldrain.com/api/account/files
```

## 🔧 **Dépannage**

### Aucune image ne s'affiche
- Vérifiez que `PIXELDRAIN_API_KEY` est définie
- Vérifiez que la clé API est valide
- Regardez les logs du serveur pour les erreurs

### Erreur 401/403
- Clé API invalide ou expirée
- Régénérez une nouvelle clé sur Pixeldrain

### Fallback vers fichiers locaux
- Le système utilise automatiquement les fichiers dans `/img/` si Pixeldrain est indisponible
- Aucune modification de code nécessaire

---

**🎯 Une fois configuré, votre site aura un stockage illimité pour les médias !**