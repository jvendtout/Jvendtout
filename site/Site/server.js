const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const app = express();

// Chemins des fichiers JSON
const categoriesPath = path.join(__dirname, 'categories.json');

// Configuration Multer pour l'upload de fichiers
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    // Nom temporaire unique
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    // Accepter images et vidéos
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non supporté'), false);
    }
  }
});

app.use(express.json());
app.use(express.static(__dirname));

// Injecter le script de chargement des articles en premier sur toutes les requêtes HTML
app.use((req, res, next) => {
  const originalSend = res.send;
  
  res.send = function(body) {
    // N'injecter que dans les pages HTML qui ne sont pas des fragments
    if (typeof body === 'string' && body.includes('<!DOCTYPE html>')) {
      // Définir loadArticles pour éviter l'erreur
      const script = `
      <script>
        // Fonction de chargement des articles
        function loadArticles() {
          return fetch('/api/articles')
            .then(response => response.json())
            .catch(error => {
              console.error('Erreur lors du chargement des articles:', error);
              return [];
            });
        }
        
        // S'assurer que la modal panier n'est pas ouverte par défaut
        document.addEventListener('DOMContentLoaded', function() {
          const panierModal = document.querySelector('.panier-modal');
          if (panierModal && panierModal.classList.contains('show')) {
            panierModal.classList.remove('show');
          }
        });
      </script>`;
      
      // Injecter le script juste après l'ouverture du head
      body = body.replace('<head>', '<head>' + script);
    }
    
    return originalSend.call(this, body);
  };
  
  next();
});

// Alias rétrocompatibilité: si requête /img/Airpods/... rediriger vers /img/Electronique/Airpods/...
app.get('/img/Airpods/:file', (req,res,next) => {
  const target = path.join(__dirname, 'img', 'Electronique', 'Airpods', req.params.file);
  if (fs.existsSync(target)) return res.sendFile(target);
  return next();
});

// Alias pour /img/Mitraillettes/* vers /img/Artifices/Mitraillettes/*
app.get('/img/Mitraillettes/:file', (req,res,next) => {
  const target = path.join(__dirname, 'img', 'Artifices', 'Mitraillettes', req.params.file);
  if (fs.existsSync(target)) return res.sendFile(target);
  return next();
});

// Alias pour /img/Tam-tam/* vers /img/Artifices/Tam-tam/*
app.get('/img/Tam-tam/:file', (req,res,next) => {
  const target = path.join(__dirname, 'img', 'Artifices', 'Tam-tam', req.params.file);
  if (fs.existsSync(target)) return res.sendFile(target);
  return next();
});

// Endpoint pour explorer les fichiers/dossiers dans img/
app.get('/api/explorer', (req, res) => {
  const relPath = req.query.path || '';
  const baseDir = path.join(__dirname, 'img');
  const targetDir = path.join(baseDir, relPath);

  // Sécurité : empêcher de sortir de /img
  if (!targetDir.startsWith(baseDir)) {
    return res.status(400).json({ error: 'Chemin invalide' });
  }

  fs.readdir(targetDir, { withFileTypes: true }, (err, files) => {
    if (err) return res.status(500).json({ error: 'Impossible de lire le dossier' });
    res.json(files.map(f => ({
      name: f.name,
      isDirectory: f.isDirectory()
    })));
  });
});

// API : lire tous les articles
app.get('/articles.json', (req, res) => {
  // Vérifier si le fichier existe, sinon créer un fichier vide
  const articlesPath = path.join(__dirname, 'articles.json');
  if (!fs.existsSync(articlesPath)) {
    fs.writeFileSync(articlesPath, JSON.stringify([], null, 2));
  }
  
  fs.readFile(articlesPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Impossible de lire les articles' });
    console.log('[GET /articles.json] length=', data ? data.length : 0);
    res.type('json').send(data || '[]');
  });
});

// Alias API standard
app.get('/api/articles', (req, res) => {
  // Vérifier si le fichier existe, sinon créer un fichier vide
  const articlesPath = path.join(__dirname, 'articles.json');
  if (!fs.existsSync(articlesPath)) {
    fs.writeFileSync(articlesPath, JSON.stringify([], null, 2));
  }
  
  fs.readFile(articlesPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Impossible de lire les articles' });
    console.log('[GET /api/articles] length=', data ? data.length : 0);
    try {
      const parsed = JSON.parse(data || '[]');
      return res.json(parsed);
    } catch(e) {
      console.error('Erreur de parsing JSON articles:', e);
      return res.status(500).json({ error: 'Parse JSON articles' });
    }
  });
});

// Root helper (optionnel)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API : ajouter un article
app.post('/api/articles', (req, res) => {
  const newArticle = req.body;
  fs.readFile(path.join(__dirname, 'articles.json'), 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Impossible de lire les articles' });
    let articles = [];
    try { articles = JSON.parse(data); } catch { }
    if (articles.find(a => a.id === newArticle.id)) {
      return res.status(400).json({ error: 'ID déjà existant' });
    }
    articles.push(newArticle);
    fs.writeFile(path.join(__dirname, 'articles.json'), JSON.stringify(articles, null, 2), err2 => {
      if (err2) return res.status(500).json({ error: 'Impossible d\'écrire les articles' });
      res.json({ success: true });
    });
  });
});

// API : modifier un article
app.put('/api/articles/:id', (req, res) => {
  const id = req.params.id;
  const updated = req.body;
  fs.readFile(path.join(__dirname, 'articles.json'), 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Impossible de lire les articles' });
    let articles = [];
    try { articles = JSON.parse(data); } catch { }
    const idx = articles.findIndex(a => a.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Article non trouvé' });
    articles[idx] = updated;
    fs.writeFile(path.join(__dirname, 'articles.json'), JSON.stringify(articles, null, 2), err2 => {
      if (err2) return res.status(500).json({ error: 'Impossible d\'écrire les articles' });
      res.json({ success: true });
    });
  });
});

// API : supprimer un article
app.delete('/api/articles/:id', (req, res) => {
  const id = req.params.id;
  fs.readFile(path.join(__dirname, 'articles.json'), 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Impossible de lire les articles' });
    let articles = [];
    try { articles = JSON.parse(data); } catch { }
    const newArticles = articles.filter(a => a.id !== id);
    if (newArticles.length === articles.length) {
      return res.status(404).json({ error: 'Article non trouvé' });
    }
    fs.writeFile(path.join(__dirname, 'articles.json'), JSON.stringify(newArticles, null, 2), err2 => {
      if (err2) return res.status(500).json({ error: 'Impossible d\'écrire les articles' });
      res.json({ success: true });
    });
  });
});

// Lire les catégories
app.get('/api/categories', (req, res) => {
  fs.readFile(categoriesPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Impossible de lire les catégories' });
    res.type('json').send(data);
  });
});

// Écrire les catégories (remplacement complet)
app.put('/api/categories', (req, res) => {
  fs.writeFile(categoriesPath, JSON.stringify(req.body, null, 2), err => {
    if (err) return res.status(500).json({ error: 'Impossible d\'écrire les catégories' });
    res.json({ success: true });
  });
});

// Catégories pour arnaques
const categoriesArnaquesPath = path.join(__dirname, 'categories-arnaques.json');

app.get('/api/categories-arnaques', (req, res) => {
  fs.readFile(categoriesArnaquesPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Impossible de lire les catégories arnaques' });
    res.type('json').send(data);
  });
});

app.put('/api/categories-arnaques', (req, res) => {
  fs.writeFile(categoriesArnaquesPath, JSON.stringify(req.body, null, 2), err => {
    if (err) return res.status(500).json({ error: 'Impossible d\'écrire les catégories arnaques' });
    res.json({ success: true });
  });
});

// Configuration pour le déploiement
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Endpoint de diagnostic des médias
app.get('/api/check-media', (req, res) => {
  try {
    const articlesRaw = fs.readFileSync(path.join(__dirname, 'articles.json'), 'utf8');
    let articles = [];
    try { articles = JSON.parse(articlesRaw); } catch(e) { return res.status(500).json({ error: 'Parse JSON articles', details: String(e) }); }

    const detailed = [];
    const missing = new Set();
    const existing = new Set();
    let totalMedia = 0;

    function checkPath(p, articleId, kind){
      if(!p) return;
      totalMedia++;
      let rel = p.replace(/^\//,'');
      const full = path.join(__dirname, rel);
      const ok = fs.existsSync(full);
      if(!ok) missing.add(p); else existing.add(p);
      if(req.query.detailed){
        detailed.push({ articleId, kind, path: p, exists: ok });
      }
    }

    articles.forEach(a => {
      checkPath(a.image, a.id, 'image');
      checkPath(a.video, a.id, 'video');
      if (a.thumbnail) checkPath(a.thumbnail, a.id, 'thumbnail');
      if (Array.isArray(a.medias)) {
        a.medias.forEach((m,i) => {
          if(m && m.path) checkPath(m.path, a.id, `medias[${i}]`);
        });
      }
    });

    res.json({
      totalArticles: articles.length,
      totalMedia,
      existing: Array.from(existing).sort(),
      missing: Array.from(missing).sort(),
      missingCount: missing.size,
      okCount: existing.size,
      detailed: req.query.detailed ? detailed : undefined
    });
  } catch(err){
    res.status(500).json({ error: 'check-media failed', details: String(err) });
  }
});

// ---- Gestion de l'ordre de pertinence ----
const orderingFile = path.join(__dirname, 'ordering.json');

function ensureOrderingFile() {
  if (!fs.existsSync(orderingFile)) {
    try {
      const raw = fs.readFileSync(path.join(__dirname, 'articles.json'), 'utf8');
      const articles = JSON.parse(raw);
      const ids = articles.map(a => a.id).filter(Boolean);
      fs.writeFileSync(orderingFile, JSON.stringify({ order: ids }, null, 2));
      console.log('[ordering] Fichier ordering.json créé');
    } catch (e) {
      fs.writeFileSync(orderingFile, JSON.stringify({ order: [] }, null, 2));
    }
  }
}
ensureOrderingFile();

app.get('/api/ordering', (req, res) => {
  try {
    ensureOrderingFile();
    const raw = fs.readFileSync(orderingFile, 'utf8');
    res.type('json').send(raw);
  } catch (e) {
    res.status(500).json({ error: 'Impossible de lire ordering', details: String(e) });
  }
});

app.put('/api/ordering', (req, res) => {
  try {
    const body = req.body;
    if (!body || !Array.isArray(body.order)) {
      return res.status(400).json({ error: 'Format attendu { order: [ids...] }' });
    }
    // Filtrer doublons et valeurs vides
    const seen = new Set();
    const cleaned = body.order.filter(id => id && !seen.has(id) && seen.add(id));
    fs.writeFileSync(orderingFile, JSON.stringify({ order: cleaned }, null, 2));
    res.json({ success: true, count: cleaned.length });
  } catch (e) {
    res.status(500).json({ error: 'Impossible d\'écrire ordering', details: String(e) });
  }
});

// Routes pour les Offres
const offresFile = path.join(__dirname, 'offres.json');

// Création du fichier si inexistant
function ensureOffresFile() {
  if (!fs.existsSync(offresFile)) {
    fs.writeFileSync(offresFile, JSON.stringify([], null, 2));
    console.log('[offres] Fichier offres.json créé');
  }
}
ensureOffresFile();

app.get('/api/offres', (req, res) => {
  try {
    ensureOffresFile();
    const data = fs.readFileSync(offresFile, 'utf8');
    res.json(JSON.parse(data || '[]'));
  } catch (e) {
    console.error('Erreur de lecture des offres:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/offres', (req, res) => {
  try {
    const offres = JSON.parse(fs.readFileSync(offresFile, 'utf8') || '[]');
    offres.push(req.body);
    fs.writeFileSync(offresFile, JSON.stringify(offres, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/offres', (req, res) => {
  try {
    fs.writeFileSync(offresFile, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Routes pour les Arnaques
const arnaquesFile = path.join(__dirname, 'arnaques.json');

// Création du fichier si inexistant
function ensureArnaquesFile() {
  if (!fs.existsSync(arnaquesFile)) {
    fs.writeFileSync(arnaquesFile, JSON.stringify([], null, 2));
    console.log('[arnaques] Fichier arnaques.json créé');
  }
}
ensureArnaquesFile();

app.get('/api/arnaques', (req, res) => {
  try {
    ensureArnaquesFile();
    const data = fs.readFileSync(arnaquesFile, 'utf8');
    res.json(JSON.parse(data || '[]'));
  } catch (e) {
    console.error('Erreur de lecture des arnaques:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/arnaques', (req, res) => {
  try {
    const arnaques = JSON.parse(fs.readFileSync(arnaquesFile, 'utf8') || '[]');
    arnaques.push(req.body);
    fs.writeFileSync(arnaquesFile, JSON.stringify(arnaques, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/arnaques', (req, res) => {
  try {
    fs.writeFileSync(arnaquesFile, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Routes pour les Preuves
const preuvesFile = path.join(__dirname, 'preuves.json');

// Création du fichier si inexistant
function ensurePreuvesFile() {
  if (!fs.existsSync(preuvesFile)) {
    fs.writeFileSync(preuvesFile, JSON.stringify([], null, 2));
    console.log('[preuves] Fichier preuves.json créé');
  }
}
ensurePreuvesFile();

app.get('/api/preuves', (req, res) => {
  try {
    ensurePreuvesFile();
    const data = fs.readFileSync(preuvesFile, 'utf8');
    res.json(JSON.parse(data || '[]'));
  } catch (e) {
    console.error('Erreur de lecture des preuves:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/preuves', (req, res) => {
  try {
    const preuves = JSON.parse(fs.readFileSync(preuvesFile, 'utf8') || '[]');
    preuves.push(req.body);
    fs.writeFileSync(preuvesFile, JSON.stringify(preuves, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/preuves', (req, res) => {
  try {
    fs.writeFileSync(preuvesFile, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Route pour les avis en attente de validation
const avisPendingFile = path.join(__dirname, 'avis-pending.json');

app.post('/api/avis-pending', (req, res) => {
  try {
    let avisPending = [];
    if (fs.existsSync(avisPendingFile)) {
      avisPending = JSON.parse(fs.readFileSync(avisPendingFile, 'utf8') || '[]');
    }
    
    // Ajouter un ID unique et la date de soumission
    const nouvelAvis = {
      id: Date.now(),
      ...req.body,
      dateSubmission: new Date().toISOString()
    };
    
    avisPending.push(nouvelAvis);
    fs.writeFileSync(avisPendingFile, JSON.stringify(avisPending, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/avis-pending', (req, res) => {
  try {
    if (fs.existsSync(avisPendingFile)) {
      const avisPending = JSON.parse(fs.readFileSync(avisPendingFile, 'utf8') || '[]');
      res.json(avisPending);
    } else {
      res.json([]);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/avis-pending', (req, res) => {
  try {
    fs.writeFileSync(avisPendingFile, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// Routes pour les avis archivés
const avisArchivedFile = path.join(__dirname, 'avis-archived.json');

// Création du fichier si inexistant
function ensureAvisArchivedFile() {
  if (!fs.existsSync(avisArchivedFile)) {
    fs.writeFileSync(avisArchivedFile, JSON.stringify([], null, 2));
    console.log('[avis-archived] Fichier avis-archived.json créé');
  }
}
ensureAvisArchivedFile();

app.get('/api/avis-archived', (req, res) => {
  try {
    ensureAvisArchivedFile();
    const data = fs.readFileSync(avisArchivedFile, 'utf8');
    res.json(JSON.parse(data || '[]'));
  } catch (e) {
    console.error('Erreur de lecture des avis archivés:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/avis-archived', (req, res) => {
  try {
    const data = fs.readFileSync(avisArchivedFile);
    const avisArchived = JSON.parse(data);
    avisArchived.push(req.body);
    fs.writeFileSync(avisArchivedFile, JSON.stringify(avisArchived, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/avis-archived', (req, res) => {
  try {
    fs.writeFileSync(avisArchivedFile, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Route pour archiver les avis - corrigée
app.post('/api/archive-reviews', (req, res) => {
  try {
    ensurePreuvesFile();
    ensureAvisArchivedFile();
    
    // Lire les avis actuels
    const reviewsData = fs.readFileSync(preuvesFile, 'utf8');
    const reviews = reviewsData ? JSON.parse(reviewsData) : [];
    
    if (reviews.length === 0) {
      return res.json({ success: true, count: 0, message: "Aucun avis à archiver" });
    }
    
    // Lire les archives existantes
    const archivedData = fs.readFileSync(avisArchivedFile, 'utf8');
    let archived = archivedData ? JSON.parse(archivedData) : [];
    
    // Mettre la date d'archivage sur chaque avis
    const timestamp = new Date().toISOString();
    const reviewsWithDate = reviews.map(review => ({
      ...review,
      dateArchive: timestamp
    }));
    
    // Ajouter les avis aux archives
    archived = [...archived, ...reviewsWithDate];
    
    // Sauvegarder les archives
    fs.writeFileSync(avisArchivedFile, JSON.stringify(archived, null, 2));
    
    // Vider le fichier d'avis
    fs.writeFileSync(preuvesFile, JSON.stringify([], null, 2));
    
    console.log(`Archivage réussi: ${reviewsWithDate.length} avis archivés`);
    res.json({ success: true, count: reviewsWithDate.length });
  } catch (error) {
    console.error('Erreur d\'archivage des avis:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Route pour sauvegarder un ordinateur - correction complète
app.post('/api/save-computer', (req, res) => {
  try {
    const computerData = req.body;
    console.log('Données ordinateur reçues:', JSON.stringify(computerData));
    
    if (!computerData) {
      return res.status(400).json({ success: false, error: 'Aucune donnée reçue' });
    }
    
    if (!computerData.nom) {
      return res.status(400).json({ success: false, error: 'Le nom de l\'ordinateur est requis' });
    }
    
    // S'assurer que le prix est un nombre
    if (computerData.prix === undefined || computerData.prix === null) {
      return res.status(400).json({ success: false, error: 'Le prix est requis' });
    }
    
    computerData.prix = parseFloat(computerData.prix);
    if (isNaN(computerData.prix)) {
      return res.status(400).json({ success: false, error: 'Le prix doit être un nombre' });
    }
    
    // Générer un ID unique si non fourni
    if (!computerData.id) {
      computerData.id = Date.now().toString();
    }
    
    // Catégorie par défaut si non fournie
    if (!computerData.categorie) {
      computerData.categorie = 'Ordinateurs';
    }
    
    // Ajout de propriétés par défaut si nécessaire
    if (!computerData.description) {
      computerData.description = `Ordinateur ${computerData.nom}`;
    }
    
    // Image par défaut si non fournie
    if (!computerData.image) {
      computerData.image = '/img/Electronique/Ordinateurs/default.jpg';
    }
    
    // Lire les articles existants
    const articlesPath = path.join(__dirname, 'articles.json');
    let articles = [];
    
    if (fs.existsSync(articlesPath)) {
      const articlesData = fs.readFileSync(articlesPath, 'utf8');
      try {
        articles = JSON.parse(articlesData || '[]');
      } catch (e) {
        console.error('Erreur de parsing JSON articles:', e);
        articles = [];
      }
    }
    
    // Vérifier si l'ID existe déjà
    const existingIndex = articles.findIndex(a => a.id === computerData.id);
    if (existingIndex >= 0) {
      // Mettre à jour l'article existant
      articles[existingIndex] = computerData;
    } else {
      // Ajouter le nouvel ordinateur
      articles.push(computerData);
    }
    
    // Sauvegarder le fichier
    fs.writeFileSync(articlesPath, JSON.stringify(articles, null, 2));
    
    console.log(`Ordinateur "${computerData.nom}" sauvegardé avec succès. ID: ${computerData.id}`);
    res.json({ success: true, article: computerData });
  } catch (error) {
    console.error('Erreur de sauvegarde d\'ordinateur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint pour upload de médias d'avis
app.post('/api/upload-avis-media', upload.array('medias[]'), (req, res) => {
  try {
    const { produitId, categorie } = req.body;
    console.log('🔧 Upload avis médias - categorie reçue:', categorie, 'produitId:', produitId);
    
    if (!req.files || req.files.length === 0) {
      return res.json({ success: true, files: [] });
    }
    
    // Transformer la catégorie pour correspondre à la structure des dossiers
    let categorieFolder = categorie || 'Divers';
    if (categorieFolder.includes('Électronique')) {
      categorieFolder = categorieFolder.replace('Électronique', 'Electroniques');
    }
    
    // Créer le dossier de destination sous img/Articles/Categories/Produit/avis/
    const targetDir = path.join(__dirname, 'img', 'Articles', categorieFolder, produitId || 'produit', 'avis');
    console.log('🔧 Dossier cible:', targetDir);
    
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    const uploadedFiles = [];
    
    // Trouver le prochain numéro d'incrémentation
    const existingFiles = fs.readdirSync(targetDir);
    let nextNumber = 1;
    
    // Chercher le plus grand numéro existant
    existingFiles.forEach(filename => {
      const match = filename.match(/^(\d+)-/);
      if (match) {
        const num = parseInt(match[1]);
        if (num >= nextNumber) {
          nextNumber = num + 1;
        }
      }
    });
    
    // Déplacer et renommer chaque fichier uploadé
    req.files.forEach((file, index) => {
      const fileExtension = path.extname(file.originalname);
      const baseFileName = produitId || 'avis';
      const newFileName = `${nextNumber + index}-${baseFileName}${fileExtension}`;
      const newPath = path.join(targetDir, newFileName);
      
      // Déplacer le fichier temporaire vers sa destination finale
      fs.renameSync(file.path, newPath);
      
      // URL relative pour le frontend avec le bon chemin Articles/Categories/Produit/avis/
      const relativePath = `img/Articles/${categorieFolder}/${produitId || 'produit'}/avis/${newFileName}`;
      console.log('🔧 Chemin généré:', relativePath);
      uploadedFiles.push(relativePath);
    });
    
    res.json({ success: true, files: uploadedFiles });
  } catch (error) {
    console.error('Erreur upload médias avis:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`🚀 Serveur lancé sur http://${HOST}:${PORT}`);
  console.log(`📊 Interface admin: http://${HOST}:${PORT}/admin.html`);
  console.log(`🛒 Boutique: http://${HOST}:${PORT}/index.html`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});