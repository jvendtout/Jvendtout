const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

// --- Définition des chemins critiques ---
const categoriesPath = path.join(__dirname, 'categories.json');

function ensureFile(filePath, defaultContent){
  if(!fs.existsSync(filePath)){
    fs.writeFileSync(filePath, defaultContent, 'utf8');
    console.log('[init] créé', path.basename(filePath));
  }
}
ensureFile(categoriesPath, '[]');

// --- Auth basique protégée pour /admin.html ---
// Variables à définir sur Render (Environment):
//  ADMIN_USER : identifiant
//  ADMIN_PASS : mot de passe (min 16+ caractères aléatoires)
//  ADMIN_TOKEN (optionnel) : jeton alternatif à envoyer dans x-admin-token
//  ADMIN_IP_WHITELIST (optionnel) : liste CSV d'IP autorisées (ex: "1.2.3.4,5.6.7.8,::1")
//  ADMIN_MAX_FAILS / ADMIN_WINDOW_MS / ADMIN_LOCK_MS (optionnels) pour ajuster la protection brute force
const ADMIN_USER = process.env.ADMIN_USER || 'Moi le dieu des dieux';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Si un connard voit ca je l\'encule';
// (Token supprimé : accès uniquement via Basic Auth et éventuel bypass IP)

// --- Configuration dynamique admin (ipWhitelist / ipBypass) ---
const adminConfigFile = path.join(__dirname, 'admin-config.json');
function loadAdminConfig(){
  try {
    if(!fs.existsSync(adminConfigFile)){
      const initial = {
        ipWhitelist: (process.env.ADMIN_IP_WHITELIST || '78.193.237.36')
          .split(',')
          .map(s=>normalizeIp(s.trim()))
          .filter(Boolean),
        ipBypass: (process.env.ADMIN_IP_BYPASS || 'true').toLowerCase() === 'true'
      };
      fs.writeFileSync(adminConfigFile, JSON.stringify(initial, null, 2));
      return initial;
    }
    const loaded = JSON.parse(fs.readFileSync(adminConfigFile,'utf8'));
    if(Array.isArray(loaded.ipWhitelist)){
      loaded.ipWhitelist = loaded.ipWhitelist.map(ip=>normalizeIp(ip));
    } else {
      loaded.ipWhitelist = [];
    }
    return loaded;
  } catch(e){
    console.error('[admin-config] erreur chargement', e);
    return { ipWhitelist: [], ipBypass: false };
  }
}
function saveAdminConfig(cfg){
  fs.writeFileSync(adminConfigFile, JSON.stringify(cfg, null, 2));
}
let runtimeConfig = loadAdminConfig();
function reloadAdminConfig(){ runtimeConfig = loadAdminConfig(); }
const MAX_FAILS = parseInt(process.env.ADMIN_MAX_FAILS || '8');
const WINDOW_MS = parseInt(process.env.ADMIN_WINDOW_MS || (15*60*1000).toString());
const LOCK_MS = parseInt(process.env.ADMIN_LOCK_MS || (30*60*1000).toString());

// Mémoire in-memory (suffisant pour un petit site sans cluster)
const authAttempts = new Map(); // ip -> {fails, first, lockUntil}

function now(){ return Date.now(); }

function registerFail(ip){
  const entry = authAttempts.get(ip) || { fails:0, first: now(), lockUntil:0 };
  // reset fenêtre si expirée
  if(now() - entry.first > WINDOW_MS){
    entry.fails = 0; entry.first = now(); entry.lockUntil = 0;
  }
  entry.fails++;
  if(entry.fails >= MAX_FAILS){
    entry.lockUntil = now() + LOCK_MS;
  }
  authAttempts.set(ip, entry);
  return entry;
}

function registerSuccess(ip){
  if(authAttempts.has(ip)) authAttempts.delete(ip);
}

function constantTimeEqual(a,b){
  if(a.length !== b.length) return false;
  let ok = 1;
  for(let i=0;i<a.length;i++) ok &= (a.charCodeAt(i) === b.charCodeAt(i)) ? 1 : 0;
  return !!ok;
}

// Normalise les IP (gère ::ffff: et ::1)
function normalizeIp(ip){
  if(!ip) return ip;
  if(ip.startsWith('::ffff:')) ip = ip.slice(7);
  if(ip === '::1') ip = '127.0.0.1';
  return ip;
}

// Récupération IP client plus robuste (priorité X-Forwarded-For)
function getClientIp(req){
  const xff = req.headers['x-forwarded-for'];
  if(xff){
    // Prendre la première IP (chaîne potentiellement "client, proxy1, proxy2")
    const first = xff.split(',')[0].trim();
    return normalizeIp(first);
  }
  return normalizeIp(req.ip || req.connection?.remoteAddress || '');
}

app.set('trust proxy', 1); // nécessaire pour avoir req.ip correcte derrière Render

if(ADMIN_PASS === 'change-me'){
  console.warn('[SECURITE] ADMIN_PASS utilise la valeur par défaut. Définissez un mot de passe fort via les variables d\'environnement.');
}

function requireAdmin(req,res,next){
  if(req.path !== '/admin.html') return next();

  const rawIp = req.ip || req.connection?.remoteAddress || 'unknown';
  const clientIp = getClientIp(req) || rawIp;
  const { ipWhitelist, ipBypass } = runtimeConfig;
  const hasWhitelist = Array.isArray(ipWhitelist) && ipWhitelist.length > 0;
  const bypassActive = !!ipBypass && hasWhitelist;

  // Log debug condensé
  console.log('[AUTH admin] ipRaw=%s clientIp=%s bypass=%s whitelist=%j', rawIp, clientIp, bypassActive, ipWhitelist);

  if(bypassActive && ipWhitelist.includes(clientIp)){
    console.log('[AUTH admin] BYPASS accordé pour', clientIp);
    registerSuccess(clientIp);
    return next();
  }

  const header = req.headers.authorization || '';
  if(!header.startsWith('Basic ')){
    res.set('WWW-Authenticate','Basic realm="Admin"');
    registerFail(clientIp);
    return res.status(401).send('Auth requise');
  }

  const attempt = authAttempts.get(clientIp);
  if(attempt && attempt.lockUntil && attempt.lockUntil > now()){
    const reste = Math.ceil((attempt.lockUntil - now())/1000);
    return res.status(429).send('Trop de tentatives. Ré essaie dans '+reste+'s');
  }

  const decoded = Buffer.from(header.slice(6),'base64').toString();
  const sep = decoded.indexOf(':');
  const u = sep === -1 ? decoded : decoded.slice(0,sep);
  const p = sep === -1 ? '' : decoded.slice(sep+1);
  const userOk = constantTimeEqual(u, ADMIN_USER);
  const passOk = constantTimeEqual(p, ADMIN_PASS);
  if(userOk && passOk){
    registerSuccess(clientIp);
    console.log('[AUTH admin] succès pour', clientIp);
    return next();
  }
  const data = registerFail(clientIp);
  const remain = Math.max(0, MAX_FAILS - data.fails);
  res.set('WWW-Authenticate','Basic realm="Admin"');
  console.log('[AUTH admin] échec credentials ip=%s restant=%d', clientIp, remain);
  return res.status(401).send('Identifiants invalides ('+remain+' tentatives restantes)');
}

// Middleware pour protéger les endpoints d'écriture API
function requireAdminWrite(req,res,next){
  // On protège toutes les méthodes sensibles (POST, PUT, DELETE) sur /api/* sauf lecture pure
  if(!req.path.startsWith('/api/')) return next();
  if(!['POST','PUT','DELETE','PATCH'].includes(req.method)) return next();

  // Réutilisation de la logique minimaliste: Basic Auth ou IP bypass
  const clientIp = getClientIp(req) || 'unknown';
  const { ipWhitelist, ipBypass } = runtimeConfig;
  if(ipBypass && Array.isArray(ipWhitelist) && ipWhitelist.length && ipWhitelist.includes(clientIp)){
    return next();
  }
  // Si pas bypass et pas token et pas Basic valide plus tard, l'IP pourra être un facteur, mais on ne bloque plus juste sur IP avant d'essayer Basic.
  // (Token retiré)
  const header = req.headers.authorization || '';
  if(header.startsWith('Basic ')){
    const decoded = Buffer.from(header.slice(6),'base64').toString();
    const sep = decoded.indexOf(':');
    const u = sep === -1 ? decoded : decoded.slice(0,sep);
    const p = sep === -1 ? '' : decoded.slice(sep+1);
    if(constantTimeEqual(u, ADMIN_USER) && constantTimeEqual(p, ADMIN_PASS)){
      return next();
    }
  }
  res.set('WWW-Authenticate','Basic realm="Admin API"');
  return res.status(401).json({ error: 'Auth requise' });
}

// Injection du middleware global avant la définition des routes API
app.use(requireAdminWrite);
app.get('/admin.html', requireAdmin, (req,res)=>{
  res.sendFile(path.join(__dirname,'admin.html'));
});

// --- Middleware fort: exige Auth Basic valide, ignore token & bypass IP ---
function requireAdminStrong(req,res,next){
  const ip = getClientIp(req) || 'unknown';
  const header = req.headers.authorization || '';
  if(!header.startsWith('Basic ')){
    res.set('WWW-Authenticate','Basic realm="AdminConfig"');
    return res.status(401).json({ error: 'Auth Basic requise' });
  }
  const decoded = Buffer.from(header.slice(6),'base64').toString();
  const sep = decoded.indexOf(':');
  const u = sep === -1 ? decoded : decoded.slice(0,sep);
  const p = sep === -1 ? '' : decoded.slice(sep+1);
  const userOk = constantTimeEqual(u, ADMIN_USER);
  const passOk = constantTimeEqual(p, ADMIN_PASS);
  if(!(userOk && passOk)){
    res.set('WWW-Authenticate','Basic realm="AdminConfig"');
    return res.status(401).json({ error: 'Identifiants invalides' });
  }
  return next();
}

// --- Endpoints de configuration sécurité ---
app.get('/api/admin/security-config', requireAdminStrong, (req,res)=>{
  // Ne jamais renvoyer l'ADMIN_PASS ni le token
  res.json({
    ipWhitelist: runtimeConfig.ipWhitelist,
    ipBypass: runtimeConfig.ipBypass
  });
});

app.put('/api/admin/security-config', requireAdminStrong, (req,res)=>{
  try {
    const { ipWhitelist, ipBypass } = req.body || {};
    if(ipWhitelist && !Array.isArray(ipWhitelist)){
      return res.status(400).json({ error: 'ipWhitelist doit être un tableau' });
    }
    if(ipWhitelist && ipWhitelist.some(ip => typeof ip !== 'string')){
      return res.status(400).json({ error: 'Chaque IP doit être une chaîne' });
    }
    if(typeof ipBypass !== 'undefined' && typeof ipBypass !== 'boolean'){
      return res.status(400).json({ error: 'ipBypass doit être booléen' });
    }
    const newCfg = { ...runtimeConfig };
    if(ipWhitelist) newCfg.ipWhitelist = ipWhitelist.map(s=>s.trim()).filter(Boolean);
    if(typeof ipBypass === 'boolean') newCfg.ipBypass = ipBypass;
    saveAdminConfig(newCfg);
    reloadAdminConfig();
    return res.json({ success: true, config: runtimeConfig });
  } catch(e){
    console.error('[admin-config] update error', e);
    return res.status(500).json({ error: 'Impossible de mettre à jour la config' });
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

// Lancer le serveur
const PORT = process.env.PORT || 3000;

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

app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
  console.log(`- Interface admin: http://localhost:${PORT}/admin.html`);
  console.log(`- Boutique: http://localhost:${PORT}/index.html`);
});