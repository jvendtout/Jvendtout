const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');

// Charger les variables d'environnement depuis le fichier .env à la racine
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();

// Configuration Multer pour upload en mémoire
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});
// Diagnostics global pour éviter les sorties silencieuses
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.stack || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// --- Définition des chemins critiques ---
const categoriesPath = path.join(__dirname, 'categories.json');

// ==================== GOFILE CONFIGURATION ====================
const GOFILE_API_KEY = process.env.GOFILE_API_KEY || 'YxYI4wVuB8zlrBiWpNZ85eXRWmDplVrl';
const GOFILE_ACCOUNT_ID = process.env.GOFILE_ACCOUNT_ID || '687ae5a7-41fe-4667-b57e-29b045c9c427';
const GOFILE_ROOT_FOLDER = process.env.GOFILE_ROOT_FOLDER || 'b0457c78-8aeb-41b5-b64d-0f4960a769a4';

// Mapping GoFile (fichier → contentId + server)
const mappingFile = path.join(__dirname, 'gofile-mapping.json');
let mediaMapping = {};

// Vérification de la configuration GoFile
if (GOFILE_API_KEY) {
  console.log(`[gofile] API Key chargée: ${GOFILE_API_KEY.substring(0, 8)}...`);
  console.log(`[gofile] Root folder: ${GOFILE_ROOT_FOLDER}`);
} else {
  console.error('[gofile] ⚠️  ATTENTION: GOFILE_API_KEY non trouvée');
}

// Charger le mapping GoFile
function loadGofileMapping(){
  try {
    if(fs.existsSync(mappingFile)){
      mediaMapping = JSON.parse(fs.readFileSync(mappingFile,'utf8')||'{}');
      const cnt = Object.keys(mediaMapping||{}).length;
      const hash = require('crypto').createHash('md5').update(JSON.stringify(mediaMapping)).digest('hex').slice(0,8);
      console.log(`[gofile] mapping chargé (${cnt} entrées) hash=${hash}`);
    } else {
      mediaMapping = {};
      console.warn('[gofile] fichier de mapping introuvable, création...');
      fs.writeFileSync(mappingFile, '{}');
    }
  } catch(e){
    console.warn('[gofile] impossible de charger le mapping:', e.message);
    mediaMapping = {};
  }
}
loadGofileMapping();

// Trouver un fichier dans le mapping par son nom
function getGofileInfoByBasename(name){
  if(!name) return null;
  const noExt = name.replace(/\.[^.]+$/, '').toLowerCase();
  
  // 1) Correspondance exacte de la clé
  const exactKey = Object.keys(mediaMapping).find(k => k.toLowerCase() === name.toLowerCase());
  if(exactKey && mediaMapping[exactKey]) return mediaMapping[exactKey];
  
  // 2) Correspondance avec préfixe img/
  const imgKey = Object.keys(mediaMapping).find(k => k.toLowerCase() === ('img/'+name).toLowerCase());
  if(imgKey && mediaMapping[imgKey]) return mediaMapping[imgKey];
  
  // 3) Par basename sans extension
  for(const [key, val] of Object.entries(mediaMapping)){
    if(!val) continue;
    const base = key.split('/').pop();
    if(!base) continue;
    const baseNoExt = base.replace(/\.[^.]+$/, '').toLowerCase();
    if(baseNoExt === noExt) return val;
  }
  return null;
}

// Obtenir le meilleur serveur pour upload
async function getGofileUploadServer() {
  try {
    const response = await fetch('https://api.gofile.io/servers', {
      headers: { 'Authorization': `Bearer ${GOFILE_API_KEY}` }
    });
    const data = await response.json();
    if (data.status === 'ok' && data.data?.servers?.length > 0) {
      // Prendre le premier serveur disponible pour l'upload
      const server = data.data.servers.find(s => s.zone === 'eu') || data.data.servers[0];
      return server.name;
    }
    return 'store1'; // fallback
  } catch (e) {
    console.error('[gofile] Erreur récupération serveur:', e.message);
    return 'store1';
  }
}

// Fonction pour uploader un fichier vers GoFile
async function uploadToGofile(buffer, filename, folderId = null) {
  if (!GOFILE_API_KEY) {
    throw new Error('GOFILE_API_KEY non configurée');
  }

  const server = await getGofileUploadServer();
  const form = new FormData();
  form.append('file', buffer, { filename });
  if (folderId) {
    form.append('folderId', folderId);
  } else {
    form.append('folderId', GOFILE_ROOT_FOLDER);
  }

  try {
    const response = await fetch(`https://${server}.gofile.io/contents/uploadfile`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GOFILE_API_KEY}`
      },
      body: form
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GoFile upload failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    if (result.status !== 'ok') {
      throw new Error(`GoFile upload error: ${result.status}`);
    }
    
    // Retourner les infos complètes du fichier
    return {
      id: result.data.fileId,
      contentId: result.data.fileId,
      name: result.data.fileName,
      downloadPage: result.data.downloadPage,
      directLink: result.data.directLink,
      server: server,
      parentFolder: result.data.parentFolder
    };
  } catch (e) {
    console.error('[gofile] Erreur upload:', e.message);
    throw e;
  }
}

// Créer un dossier sur GoFile
async function createGofileFolder(folderName, parentFolderId = null) {
  if (!GOFILE_API_KEY) {
    throw new Error('GOFILE_API_KEY non configurée');
  }

  try {
    const response = await fetch('https://api.gofile.io/contents/createFolder', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GOFILE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        parentFolderId: parentFolderId || GOFILE_ROOT_FOLDER,
        folderName: folderName
      })
    });

    const result = await response.json();
    if (result.status !== 'ok') {
      throw new Error(`GoFile folder creation error: ${JSON.stringify(result)}`);
    }
    
    console.log(`[gofile] Dossier créé: ${folderName} (${result.data.folderId})`);
    return result.data;
  } catch (e) {
    console.error('[gofile] Erreur création dossier:', e.message);
    throw e;
  }
}

// Lister le contenu d'un dossier GoFile
async function listGofileFolder(folderId = null) {
  if (!GOFILE_API_KEY) {
    throw new Error('GOFILE_API_KEY non configurée');
  }

  const targetFolder = folderId || GOFILE_ROOT_FOLDER;

  try {
    const response = await fetch(`https://api.gofile.io/contents/${targetFolder}?token=${GOFILE_API_KEY}`, {
      headers: {
        'Authorization': `Bearer ${GOFILE_API_KEY}`
      }
    });

    const result = await response.json();
    if (result.status !== 'ok') {
      throw new Error(`GoFile list error: ${JSON.stringify(result)}`);
    }
    
    return result.data;
  } catch (e) {
    console.error('[gofile] Erreur listage dossier:', e.message);
    throw e;
  }
}

// Supprimer un contenu GoFile (fichier ou dossier)
async function deleteGofileContent(contentId) {
  if (!GOFILE_API_KEY) {
    throw new Error('GOFILE_API_KEY non configurée');
  }

  try {
    const response = await fetch(`https://api.gofile.io/contents/${contentId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${GOFILE_API_KEY}`
      }
    });

    const result = await response.json();
    if (result.status !== 'ok') {
      throw new Error(`GoFile delete error: ${JSON.stringify(result)}`);
    }
    
    console.log(`[gofile] Contenu supprimé: ${contentId}`);
    return true;
  } catch (e) {
    console.error('[gofile] Erreur suppression:', e.message);
    throw e;
  }
}

// Construire l'URL de téléchargement direct GoFile
function buildGofileDownloadUrl(fileInfo) {
  if (!fileInfo) return null;
  // Format: https://{server}.gofile.io/download/web/{contentId}/{filename}
  if (fileInfo.directLink) return fileInfo.directLink;
  if (fileInfo.server && fileInfo.id && fileInfo.name) {
    return `https://${fileInfo.server}.gofile.io/download/web/${fileInfo.id}/${encodeURIComponent(fileInfo.name)}`;
  }
  return null;
}

// Sauvegarder le mapping GoFile
function saveGofileMapping() {
  try {
    fs.writeFileSync(mappingFile, JSON.stringify(mediaMapping, null, 2));
    const cnt = Object.keys(mediaMapping).length;
    const hash = require('crypto').createHash('md5').update(JSON.stringify(mediaMapping)).digest('hex').slice(0,8);
    console.log(`[gofile] mapping sauvegardé (${cnt} entrées) hash=${hash}`);
    return true;
  } catch (e) {
    console.error('[gofile] Erreur sauvegarde mapping:', e.message);
    return false;
  }
}

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
    return { ipWhitelist: [], ipBypass: true };
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
  if(ip === '::1') ip = '78.193.237.36';
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

// ==================== GOFILE API ENDPOINTS ====================

// Lister les fichiers GoFile (pour l'admin)
app.get('/images', async (req,res)=>{
  try {
    const folderId = req.query.folderId || GOFILE_ROOT_FOLDER;
    const data = await listGofileFolder(folderId);
    
    // Transformer en format compatible avec l'ancien format Pixeldrain
    const files = [];
    if (data.children) {
      for (const [id, content] of Object.entries(data.children)) {
        files.push({
          id: content.id,
          name: content.name,
          type: content.type, // 'file' ou 'folder'
          size: content.size || 0,
          createTime: content.createTime,
          modTime: content.modTime,
          downloadCount: content.downloadCount || 0,
          server: data.servers?.[0] || 'store1',
          directLink: content.link,
          parentFolder: data.id,
          isFolder: content.type === 'folder',
          mimetype: content.mimetype || ''
        });
      }
    }
    
    console.log(`[/images] ${files.length} fichiers/dossiers renvoyés depuis ${folderId}`);
    return res.json(files);
  } catch(e){
    console.error('[/images] error', e);
    return res.status(500).json({ error: 'Failed to fetch GoFile files', details: String(e) });
  }
});

// Lister le contenu d'un dossier spécifique
app.get('/api/gofile/contents', async (req, res) => {
  try {
    const folderId = GOFILE_ROOT_FOLDER;
    const data = await listGofileFolder(folderId);
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[/api/gofile/contents] error', e);
    return res.status(500).json({ error: 'Failed to list folder', details: String(e) });
  }
});

app.get('/api/gofile/contents/:folderId', async (req, res) => {
  try {
    const folderId = req.params.folderId || GOFILE_ROOT_FOLDER;
    const data = await listGofileFolder(folderId);
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[/api/gofile/contents] error', e);
    return res.status(500).json({ error: 'Failed to list folder', details: String(e) });
  }
});

// Créer un dossier
app.post('/api/gofile/folder', async (req, res) => {
  try {
    const { folderName, parentFolderId } = req.body;
    if (!folderName) {
      return res.status(400).json({ error: 'folderName requis' });
    }
    const result = await createGofileFolder(folderName, parentFolderId);
    return res.json({ success: true, data: result });
  } catch (e) {
    console.error('[/api/gofile/folder] error', e);
    return res.status(500).json({ error: 'Failed to create folder', details: String(e) });
  }
});

// Supprimer un fichier ou dossier
app.delete('/api/gofile/content/:contentId', async (req, res) => {
  try {
    const { contentId } = req.params;
    await deleteGofileContent(contentId);
    
    // Retirer du mapping si présent
    for (const [key, val] of Object.entries(mediaMapping)) {
      if (val && val.id === contentId) {
        delete mediaMapping[key];
      }
    }
    saveGofileMapping();
    
    return res.json({ success: true, deleted: contentId });
  } catch (e) {
    console.error('[/api/gofile/content] delete error', e);
    return res.status(500).json({ error: 'Failed to delete content', details: String(e) });
  }
});

// Upload vers GoFile
app.post('/api/gofile/upload', upload.array('files', 20), async (req, res) => {
  try {
    const folderId = req.body.folderId || GOFILE_ROOT_FOLDER;
    const uploadedFiles = [];
    
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const result = await uploadToGofile(file.buffer, file.originalname, folderId);
          
          // Ajouter au mapping
          const mappedPath = `img/${file.originalname}`;
          mediaMapping[mappedPath] = {
            id: result.id,
            name: result.name,
            server: result.server,
            directLink: result.directLink
          };
          
          uploadedFiles.push({
            originalName: file.originalname,
            ...result
          });
          
          console.log(`[gofile] ✓ ${file.originalname} → ${result.id}`);
        } catch (uploadError) {
          console.error(`[gofile] ✗ Échec upload ${file.originalname}:`, uploadError.message);
        }
      }
      
      if (uploadedFiles.length > 0) {
        saveGofileMapping();
      }
    }
    
    return res.json({ 
      success: true, 
      uploaded: uploadedFiles.length,
      files: uploadedFiles
    });
  } catch (e) {
    console.error('[/api/gofile/upload] error', e);
    return res.status(500).json({ error: 'Upload failed', details: String(e) });
  }
});

// Régénérer le mapping automatiquement depuis GoFile
app.get('/api/regenerate-mapping', async (req, res) => {
  try {
    const newMapping = {};
    
    // Fonction récursive pour parcourir les dossiers
    async function scanFolder(folderId, pathPrefix = 'img/') {
      const data = await listGofileFolder(folderId);
      const server = data.servers?.[0] || 'store1';
      
      if (data.children) {
        for (const [id, content] of Object.entries(data.children)) {
          if (content.type === 'folder') {
            // Parcourir récursivement
            await scanFolder(content.id, pathPrefix + content.name + '/');
          } else {
            // C'est un fichier
            newMapping[pathPrefix + content.name] = {
              id: content.id,
              name: content.name,
              server: server,
              directLink: content.link
            };
          }
        }
      }
    }
    
    await scanFolder(GOFILE_ROOT_FOLDER);
    
    // Sauvegarder le nouveau mapping
    fs.writeFileSync(mappingFile, JSON.stringify(newMapping, null, 2));
    
    // Recharger en mémoire
    loadGofileMapping();
    
    console.log(`[regenerate-mapping] ${Object.keys(newMapping).length} fichiers mappés`);
    return res.json({ success: true, count: Object.keys(newMapping).length, mapping: newMapping });
  } catch (e) {
    console.error('[/api/regenerate-mapping] error', e);
    return res.status(500).json({ error: 'Failed to regenerate mapping', details: String(e) });
  }
});

// ==================== PING ALL FILES (pour garder les fichiers actifs) ====================
app.get('/api/ping-all', async (req, res) => {
  try {
    const results = { success: 0, failed: 0, files: [] };
    
    // Fonction récursive pour pinger tous les fichiers
    async function pingFolder(folderId) {
      const data = await listGofileFolder(folderId);
      
      if (data.children) {
        for (const [id, content] of Object.entries(data.children)) {
          if (content.type === 'folder') {
            await pingFolder(content.id);
          } else {
            // C'est un fichier - on le "ping" en récupérant ses infos
            results.success++;
            results.files.push({
              name: content.name,
              id: content.id,
              size: content.size
            });
          }
        }
      }
    }
    
    await pingFolder(GOFILE_ROOT_FOLDER);
    
    console.log(`[ping-all] ${results.success} fichiers pingés`);
    return res.json({ 
      success: true, 
      message: `${results.success} fichiers pingés avec succès`,
      count: results.success,
      files: results.files
    });
  } catch (e) {
    console.error('[/api/ping-all] error', e);
    return res.status(500).json({ error: 'Ping failed', details: String(e) });
  }
});

// ========== Routes pour les arnaques en attente ==========
const arnaquesPendingFile = path.join(__dirname, 'arnaques_pending_data.json');

function ensureArnaquesPendingFile() {
  try {
    if (!fs.existsSync(arnaquesPendingFile)) {
      fs.writeFileSync(arnaquesPendingFile, JSON.stringify([], null, 2));
      console.log('[arnaques-pending] Fichier créé');
    } else {
      console.log('[arnaques-pending] Fichier existe déjà');
    }
  } catch (e) {
    console.error('[arnaques-pending] Erreur dans ensureArnaquesPendingFile:', e);
    throw e;
  }
}

console.log('[arnaques-pending] Avant ensureArnaquesPendingFile');
ensureArnaquesPendingFile();
console.log('[arnaques-pending] Après ensureArnaquesPendingFile');

app.post('/api/arnaques-pending', upload.array('preuves', 20), async (req, res) => {
  console.log('[/api/arnaques-pending] POST request received');
  try {
    let arnaquesPending = [];
    if (fs.existsSync(arnaquesPendingFile)) {
      arnaquesPending = JSON.parse(fs.readFileSync(arnaquesPendingFile, 'utf8') || '[]');
    }
    
    // Parser les données (peut être dans req.body.data si FormData)
    let arnaqueData;
    if (req.body.data) {
      // FormData: les données sont dans req.body.data
      arnaqueData = JSON.parse(req.body.data);
      console.log('[arnaques-pending] Données parsées depuis FormData');
    } else {
      // JSON direct
      arnaqueData = req.body;
      console.log('[arnaques-pending] Données JSON directes');
    }
    
    // Uploader les fichiers vers GoFile si présents
    const uploadedMedias = [];
    if (req.files && req.files.length > 0) {
      console.log(`[arnaques-pending] ${req.files.length} fichier(s) reçu(s) pour upload GoFile`);
      const timestamp = Date.now();
      
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        try {
          // Générer un nom unique
          const ext = file.originalname.split('.').pop();
          const uniqueFileName = `arnaque-preuve-${timestamp}-${i + 1}.${ext}`;
          
          // Upload vers GoFile
          const gofileResult = await uploadToGofile(file.buffer, uniqueFileName);
          
          // Générer le chemin mappé
          const mappedPath = `img/arnaques/${uniqueFileName}`;
          
          // Ajouter au mapping
          mediaMapping[mappedPath] = {
            id: gofileResult.id,
            name: gofileResult.name,
            server: gofileResult.server,
            directLink: gofileResult.directLink
          };
          
          uploadedMedias.push(mappedPath);
          
          console.log(`[gofile] ✓ ${uniqueFileName} → ${gofileResult.id} (mappé: ${mappedPath})`);
        } catch (uploadError) {
          console.error(`[gofile] ✗ Échec upload ${file.originalname}:`, uploadError.message);
        }
      }
      
      // Sauvegarder le mapping
      if (uploadedMedias.length > 0) {
        saveGofileMapping();
      }
    }
    
    const nouvelleArnaque = {
      id: Date.now(),
      ...arnaqueData,
      preuves: uploadedMedias.length > 0 ? uploadedMedias : (arnaqueData.preuves || []),
      dateSubmission: new Date().toISOString(),
      verified: false
    };
    
    console.log('[arnaques-pending] Nouvelle arnaque:', {
      id: nouvelleArnaque.id,
      denonceur: nouvelleArnaque.denonceur,
      denonceurReel: nouvelleArnaque.denonceurReel,
      isAnonymous: nouvelleArnaque.isAnonymous,
      preuves: nouvelleArnaque.preuves.length + ' média(s)'
    });
    
    arnaquesPending.push(nouvelleArnaque);
    fs.writeFileSync(arnaquesPendingFile, JSON.stringify(arnaquesPending, null, 2));
    console.log('[/api/arnaques-pending] Arnaque ajoutée avec succès');
    res.json({ success: true, uploaded: uploadedMedias.length });
  } catch (e) {
    console.error('[/api/arnaques-pending] Erreur:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/arnaques-pending', (req, res) => {
  try {
    if (fs.existsSync(arnaquesPendingFile)) {
      const arnaquesPending = JSON.parse(fs.readFileSync(arnaquesPendingFile, 'utf8') || '[]');
      res.json(arnaquesPending);
    } else {
      res.json([]);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/arnaques-pending', (req, res) => {
  try {
    fs.writeFileSync(arnaquesPendingFile, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(__dirname));

// Endpoint de santé ultra léger pour keep-alive / monitoring
// - Répond en < 1ms avec 200 OK
// - Compatible GET et HEAD (Express gère HEAD automatiquement)
app.get('/health', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json({ ok: true, uptime: process.uptime(), timestamp: new Date().toISOString() });
  } catch (e) {
    // Même en cas d’erreur inattendue, renvoyer un 200 minimal pour éviter les faux négatifs de ping
    res.status(200).end();
  }
});

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
          // Tente d'abord les articles ordonnés, sinon fallback
          return fetch('/api/articles-ordered')
            .then(r => r.ok ? r.json() : Promise.reject())
            .catch(() => fetch('/api/articles').then(r => r.json()))
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

// Route debug pour lister les routes enregistrées
app.get('/api/_debug/routes', (req,res)=>{
  try {
    const collected = [];
    const stack = (app._router && app._router.stack) ? app._router.stack : [];
    for(const layer of stack){
      if(layer && layer.route){
        const methods = Object.keys(layer.route.methods||{}).filter(m=>layer.route.methods[m]);
        collected.push({ path: layer.route.path, methods });
      }
    }
    // Ajout rapide des chemins clés qu'on s'attend à voir
    const expected = ['/img/:filename','/api/_debug/media-lookup','/api/_debug/mapping'];
    const missing = expected.filter(p => !collected.some(r => r.path === p));
    res.json({ count: collected.length, routes: collected, missingExpected: missing });
  } catch(e){
    res.status(500).json({ error:'debug routes failed', details:e.message });
  }
});

// Debug: lookup mapping Pixeldrain
app.get('/api/_debug/media-lookup', (req,res) => {
  try {
    const name = (req.query.name || '').toString();
    const id = getPixeldrainIdByBasename(name);
    return res.json({ name, id, tried: ['exact','basename'], redirect: id ? `https://pixeldrain.com/api/file/${id}` : null });
  } catch(e){
    return res.status(500).json({ error:'lookup failed', details: String(e) });
  }
});

// Debug: exposer le mapping (tronqué)
app.get('/api/_debug/mapping', (req,res)=>{
  try {
    const entries = Object.entries(mediaMapping||{});
    const sample = entries.slice(0, 100).map(([k,v])=>({ key:k, id:v }));
    const hash = require('crypto').createHash('md5').update(JSON.stringify(mediaMapping)).digest('hex').slice(0,8);
    res.json({ count: entries.length, hash, sample });
  } catch(e){
    res.status(500).json({ error:'mapping dump failed', details:String(e) });
  }
});

// Admin: recharger le mapping à chaud (pas d’auth forte ici, à renforcer si exposé)
app.post('/api/_admin/reload-mapping', (req,res)=>{
  try {
    loadPixeldrainMapping();
    const cnt = Object.keys(mediaMapping||{}).length;
    const hash = require('crypto').createHash('md5').update(JSON.stringify(mediaMapping)).digest('hex').slice(0,8);
    res.json({ success:true, count: cnt, hash });
  } catch(e){
    res.status(500).json({ error:'reload failed', details:String(e) });
  }
});


// Endpoint pour explorer les fichiers/dossiers dans img/
app.get('/api/explorer', (req, res) => {
  const relPath = req.query.path || '';
  const baseDir = path.join(__dirname, 'img');
  const targetDir = path.join(baseDir, relPath);


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

// Servir médias via proxy GoFile si non présents localement
app.get('/img/:filename', async (req, res) => {
  try {
    const requested = req.params.filename;
    if(!requested){ return res.status(400).send('missing filename'); }
    const localRel = path.join('img', requested);
    const localAbs = path.join(__dirname, localRel);
    console.log('[img] lookup', requested);

    // 1) Si le fichier existe en local, on le sert directement
    if (fs.existsSync(localAbs)) {
      return res.sendFile(localAbs);
    }

    // 2) Sinon, tenter une résolution via le mapping GoFile
    const fileInfo = getGofileInfoByBasename(requested);
    console.log('[img] mapping info', requested, '->', fileInfo ? fileInfo.id : null);
    
    if (fileInfo) {
      // Proxy le fichier depuis GoFile avec le token d'authentification
      try {
        const downloadUrl = buildGofileDownloadUrl(fileInfo) || fileInfo.directLink;
        if (downloadUrl) {
          const response = await fetch(downloadUrl, {
            headers: {
              'Cookie': `accountToken=${GOFILE_API_KEY}`,
              'Authorization': `Bearer ${GOFILE_API_KEY}`
            }
          });
          
          if (response.ok) {
            // Transférer les headers pertinents
            const contentType = response.headers.get('content-type');
            if (contentType) res.set('Content-Type', contentType);
            res.set('Cache-Control', 'public, max-age=86400, s-maxage=86400');
            
            // Stream le contenu
            const buffer = await response.buffer();
            return res.send(buffer);
          }
        }
      } catch (proxyError) {
        console.error('[img] proxy error:', proxyError.message);
      }
    }

    // 3) Fallback image propre si c'est un format d'image
    const ext = path.extname(requested).toLowerCase();
    const isImage = ['.png','.jpg','.jpeg','.webp','.gif','.svg','.bmp','.ico'].includes(ext);
    if (isImage) {
      const placeholder = path.join(__dirname, 'img', '_technique', 'icon', 'produit.png');
      if (fs.existsSync(placeholder)) {
        res.set('Cache-Control', 'no-cache');
        return res.sendFile(placeholder);
      }
    }

    return res.status(404).send('Not found');
  } catch(e){
    console.error('[img] error', e);
    return res.status(500).send('img route error');
  }
});

// Route proxy pour les médias GoFile (avec authentification)
app.get('/media/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const { name } = req.query; // Nom du fichier optionnel
    
    // Chercher dans le mapping ou utiliser les paramètres
    let fileInfo = null;
    for (const [key, val] of Object.entries(mediaMapping)) {
      if (val && val.id === fileId) {
        fileInfo = val;
        break;
      }
    }
    
    // Construire l'URL de téléchargement
    const server = fileInfo?.server || req.query.server || 'store1';
    const fileName = name || fileInfo?.name || 'file';
    const downloadUrl = `https://${server}.gofile.io/download/web/${fileId}/${encodeURIComponent(fileName)}`;
    
    const response = await fetch(downloadUrl, {
      headers: {
        'Cookie': `accountToken=${GOFILE_API_KEY}`,
        'Authorization': `Bearer ${GOFILE_API_KEY}`
      }
    });
    
    if (!response.ok) {
      return res.status(response.status).send('File not found on GoFile');
    }
    
    // Transférer les headers
    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    if (contentType) res.set('Content-Type', contentType);
    if (contentLength) res.set('Content-Length', contentLength);
    res.set('Cache-Control', 'public, max-age=86400');
    
    // Stream le contenu
    const buffer = await response.buffer();
    return res.send(buffer);
  } catch (e) {
    console.error('[/media] error', e);
    return res.status(500).send('Media proxy error');
  }
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
      // Ajouter l'ID dans ordering.json si absent
      try {
        if(newArticle.id){
          const { order } = loadOrdering();
          if(!order.includes(newArticle.id)){
            order.push(newArticle.id);
            saveOrdering(order);
          }
        }
      } catch(e){ console.warn('[ordering] échec ajout nouvel article', e); }
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
      // Retirer l'ID de ordering.json
      try {
        const { order } = loadOrdering();
        const filtered = order.filter(x => x !== id);
        if(filtered.length !== order.length){
          saveOrdering(filtered);
        }
      } catch(e){ console.warn('[ordering] échec suppression ID', e); }
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

// Routes Techniques Arnaques
const techniquesArnaquesPath = path.join(__dirname, 'techniques-arnaques.json');
app.get('/api/techniques-arnaques', (req, res) => {
  fs.readFile(techniquesArnaquesPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Impossible de lire les techniques' });
    res.type('json').send(data);
  });
});

app.put('/api/techniques-arnaques', (req, res) => {
  fs.writeFile(techniquesArnaquesPath, JSON.stringify(req.body, null, 2), err => {
    if (err) return res.status(500).json({ error: 'Impossible d\'écrire les techniques' });
    res.json({ success: true });
  });
});

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

// --- Helpers ordering avancé ---
function loadOrdering(){
  try {
    ensureOrderingFile();
    const raw = fs.readFileSync(orderingFile,'utf8');
    const parsed = JSON.parse(raw || '{}');
    if(!parsed.order || !Array.isArray(parsed.order)) return { order: [] };
    return { order: parsed.order.filter(id => !!id) };
  } catch(e){
    return { order: [] };
  }
}
function saveOrdering(order){
  const seen = new Set();
  const cleaned = order.filter(id => id && !seen.has(id) && seen.add(id));
  fs.writeFileSync(orderingFile, JSON.stringify({ order: cleaned }, null, 2));
  return cleaned;
}
function syncOrderingWithArticles(){
  const articlesPath = path.join(__dirname,'articles.json');
  let articles = [];
  try { if(fs.existsSync(articlesPath)) articles = JSON.parse(fs.readFileSync(articlesPath,'utf8')||'[]'); } catch{}
  const existingIds = articles.map(a=>a.id).filter(Boolean);
  const { order } = loadOrdering();
  const included = new Set();
  const newOrder = [];
  for(const id of order){
    if(existingIds.includes(id) && !included.has(id)){
      included.add(id); newOrder.push(id);
    }
  }
  for(const id of existingIds){
    if(!included.has(id)){
      included.add(id); newOrder.push(id);
    }
  }
  saveOrdering(newOrder);
  return newOrder;
}

// Endpoint renvoyant les articles dans l'ordre configuré
app.get('/api/articles-ordered', (req,res) => {
  try {
    const articlesPath = path.join(__dirname,'articles.json');
    let articles = [];
    if(fs.existsSync(articlesPath)){
      try { articles = JSON.parse(fs.readFileSync(articlesPath,'utf8')||'[]'); } catch(e){ return res.status(500).json({ error: 'Parse JSON articles' }); }
    }
    const order = syncOrderingWithArticles();
    const byId = new Map(articles.map(a=>[a.id,a]));
    const orderedArticles = order.map(id => byId.get(id)).filter(Boolean);
    if(orderedArticles.length !== articles.length){
      const inSet = new Set(order);
      articles.forEach(a => { if(!inSet.has(a.id)) orderedArticles.push(a); });
    }
    return res.json(orderedArticles);
  } catch(e){
    return res.status(500).json({ error: 'Impossible de générer articles-ordered', details: String(e) });
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

// Routes pour les arnaques archivées
const arnaquesArchivedFile = path.join(__dirname, 'arnaques-archived.json');

function ensureArnaquesArchivedFile() {
  if (!fs.existsSync(arnaquesArchivedFile)) {
    fs.writeFileSync(arnaquesArchivedFile, '[]');
  }
}

app.get('/api/arnaques-archived', (req, res) => {
  try {
    ensureArnaquesArchivedFile();
    const data = fs.readFileSync(arnaquesArchivedFile, 'utf8');
    res.json(JSON.parse(data || '[]'));
  } catch (e) {
    console.error('Erreur de lecture des arnaques archivées:', e);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/arnaques-archived', (req, res) => {
  try {
    ensureArnaquesArchivedFile();
    fs.writeFileSync(arnaquesArchivedFile, JSON.stringify(req.body, null, 2));
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
    // Mettre à jour ordering si nouvelle création
    try {
      if(existingIndex === -1 && computerData.id){
        const { order } = loadOrdering();
        if(!order.includes(computerData.id)){
          order.push(computerData.id);
          saveOrdering(order);
        }
      }
    } catch(e){ console.warn('[ordering] save-computer sync échouée', e); }
    res.json({ success: true, article: computerData });
  } catch (error) {
    console.error('Erreur de sauvegarde d\'ordinateur:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- Messages Preuve (courts messages anonymes distincts des avis classiques) ----
const messagesPreuveFile = path.join(__dirname, 'messages-preuve.json');
function ensureMessagesPreuveFile(){
  if(!fs.existsSync(messagesPreuveFile)){
    fs.writeFileSync(messagesPreuveFile, JSON.stringify([], null, 2));
    console.log('[messages-preuve] Fichier messages-preuve.json créé');
  }
}
ensureMessagesPreuveFile();

app.get('/api/messages-preuve', (req,res)=>{
  try {
    ensureMessagesPreuveFile();
    const data = fs.readFileSync(messagesPreuveFile,'utf8');
    return res.json(JSON.parse(data||'[]'));
  } catch(e){
    console.error('[messages-preuve] lecture échouée', e);
    return res.status(500).json({ error:'Impossible de lire messages-preuve' });
  }
});

// Endpoint dédié pour upload de médias d'avis (sans enregistrer dans messages-preuve.json)
app.post('/api/upload-avis-media', upload.array('medias', 10), async (req, res) => {
  try {
    const body = req.body || {};
    const uploadedMedias = [];
    const timestamp = Date.now();
    
    if (req.files && req.files.length > 0) {
      console.log(`[upload-avis-media] ${req.files.length} fichier(s) reçu(s) pour upload GoFile`);
      
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        try {
          // Générer un nom de fichier unique avec timestamp + index
          const ext = file.originalname.split('.').pop();
          const titre = body.titre || 'media';
          const slug = titre.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          const uniqueFileName = `${slug}-${timestamp}-${i + 1}.${ext}`;
          
          // Upload vers GoFile avec le nom unique
          const gofileResult = await uploadToGofile(file.buffer, uniqueFileName);
          
          // Générer le chemin mappé
          const mappedPath = `img/${uniqueFileName}`;
          
          // Ajouter au mapping
          mediaMapping[mappedPath] = {
            id: gofileResult.id,
            name: gofileResult.name,
            server: gofileResult.server,
            directLink: gofileResult.directLink
          };
          
          // Ajouter aux médias
          uploadedMedias.push({
            type: file.mimetype.startsWith('image/') ? 'image' : 'video',
            path: mappedPath,
            url: `/media/${gofileResult.id}?name=${encodeURIComponent(gofileResult.name)}&server=${gofileResult.server}`,
            name: uniqueFileName,
            gofile_id: gofileResult.id,
            size: file.size
          });
          
          console.log(`[gofile] ✓ ${uniqueFileName} (original: ${file.originalname}) → ${gofileResult.id} (mappé: ${mappedPath})`);
        } catch (uploadError) {
          console.error(`[gofile] ✗ Échec upload ${file.originalname}:`, uploadError.message);
          // Continue avec les autres fichiers
        }
      }
      
      // Sauvegarder le mapping mis à jour
      if (uploadedMedias.length > 0) {
        saveGofileMapping();
      }
    }
    
    return res.json({ 
      success: true, 
      uploaded: uploadedMedias.length,
      medias: uploadedMedias
    });
  } catch(e){
    console.error('[upload-avis-media] échec', e);
    return res.status(500).json({ error:'Impossible d\'uploader les médias', details: e.message });
  }
});

app.post('/api/messages-preuve', upload.array('medias', 10), async (req, res) => {
  try {
    ensureMessagesPreuveFile();
    const body = req.body || {};
    
    // Validation du message
    if(!body.message || typeof body.message !== 'string' || !body.message.trim()){
      return res.status(400).json({ error: 'Champ message requis' });
    }

    // Traiter les fichiers uploadés
    const uploadedMedias = [];
    
    if (req.files && req.files.length > 0) {
      console.log(`[messages-preuve] ${req.files.length} fichier(s) reçu(s) pour upload GoFile`);
      
      for (const file of req.files) {
        try {
          // Upload vers GoFile
          const gofileResult = await uploadToGofile(file.buffer, file.originalname);
          
          // Générer le chemin mappé
          const mappedPath = `img/${file.originalname}`;
          
          // Ajouter au mapping
          mediaMapping[mappedPath] = {
            id: gofileResult.id,
            name: gofileResult.name,
            server: gofileResult.server,
            directLink: gofileResult.directLink
          };
          
          // Ajouter aux médias
          uploadedMedias.push({
            type: file.mimetype.startsWith('image/') ? 'image' : 'video',
            path: mappedPath,
            url: `/media/${gofileResult.id}?name=${encodeURIComponent(gofileResult.name)}&server=${gofileResult.server}`,
            name: file.originalname,
            gofile_id: gofileResult.id,
            size: file.size
          });
          
          console.log(`[gofile] ✓ ${file.originalname} → ${gofileResult.id} (mappé: ${mappedPath})`);
        } catch (uploadError) {
          console.error(`[gofile] ✗ Échec upload ${file.originalname}:`, uploadError.message);
          // Continue avec les autres fichiers
        }
      }
      
      // Sauvegarder le mapping mis à jour
      if (uploadedMedias.length > 0) {
        saveGofileMapping();
      }
    }
    
    // Combiner avec les médias existants dans body.medias (si envoyés)
    const existingMedias = Array.isArray(body.medias) ? body.medias.slice(0, 10) : [];
    const allMedias = [...uploadedMedias, ...existingMedias].slice(0, 10);

    const list = JSON.parse(fs.readFileSync(messagesPreuveFile,'utf8')||'[]');
    const entry = {
      id: Date.now().toString(36)+Math.random().toString(36).slice(2,8),
      titre: body.titre?.toString().slice(0,120) || null,
      message: body.message.toString().slice(0,2000),
      produit: body.produit || null,
      medias: allMedias,
      dateSubmission: new Date().toISOString()
    };
    
    list.push(entry);
    fs.writeFileSync(messagesPreuveFile, JSON.stringify(list,null,2));
    
    return res.json({ 
      success: true, 
      entry,
      uploaded: uploadedMedias.length,
      medias: allMedias
    });
  } catch(e){
    console.error('[messages-preuve] ajout échoué', e);
    return res.status(500).json({ error:'Impossible d\'ajouter un message', details: e.message });
  }
});

app.delete('/api/messages-preuve/:id', (req,res)=>{
  try {
    ensureMessagesPreuveFile();
    const id = req.params.id;
    const list = JSON.parse(fs.readFileSync(messagesPreuveFile,'utf8')||'[]');
    const filtered = list.filter(m=>m.id !== id);
    if(filtered.length === list.length){
      return res.status(404).json({ error:'Message non trouvé' });
    }
    fs.writeFileSync(messagesPreuveFile, JSON.stringify(filtered,null,2));
    return res.json({ success:true, removed:id });
  } catch(e){
    console.error('[messages-preuve] suppression échouée', e);
    return res.status(500).json({ error:'Impossible de supprimer' });
  }
});

// ---- Annonces (section dédiée) ----
const annoncesFile = path.join(__dirname, 'annonces.json');
function ensureAnnoncesFile(){
  if(!fs.existsSync(annoncesFile)){
    fs.writeFileSync(annoncesFile, JSON.stringify([], null, 2));
    console.log('[annonces] Fichier annonces.json créé');
  }
}
ensureAnnoncesFile();

// ---- Page Infos personnalisée ----
const infosPageFile = path.join(__dirname, 'info-page.json');
function ensureInfosPageFile(){
  if(!fs.existsSync(infosPageFile)){
    fs.writeFileSync(infosPageFile, JSON.stringify({ elements: [] }, null, 2));
    console.log('[infos-page] Fichier info-page.json créé');
  }
}
ensureInfosPageFile();

// GET toutes les annonces
app.get('/api/annonces', (req,res)=>{
  try {
    ensureAnnoncesFile();
    const raw = fs.readFileSync(annoncesFile,'utf8');
    return res.json(JSON.parse(raw||'[]'));
  } catch(e){
    console.error('[annonces] lecture échouée', e);
    return res.status(500).json({ error:'Impossible de lire annonces' });
  }
});

// POST nouvelle annonce
app.post('/api/annonces', (req,res)=>{
  try {
    console.log('[HTTP POST /api/annonces] body=', req.body);
    ensureAnnoncesFile();
    const body = req.body || {};
    if(!body.message || !body.message.trim()){
      return res.status(400).json({ error:'Message requis' });
    }
    const list = JSON.parse(fs.readFileSync(annoncesFile,'utf8')||'[]');
    const entry = {
      id: Date.now().toString(36)+Math.random().toString(36).slice(2,6),
      titre: body.titre?.toString().slice(0,140) || null,
      message: body.message.toString().slice(0,4000),
      produits: Array.isArray(body.produits)? body.produits.slice(0,20) : [], // IDs produits liés
      medias: Array.isArray(body.medias)? body.medias.slice(0,10): [],
      lien: body.lien || null, // URL externe éventuellement
      dateCreation: new Date().toISOString(),
      dateMaj: null
    };
    list.push(entry);
    fs.writeFileSync(annoncesFile, JSON.stringify(list,null,2));
    return res.json({ success:true, entry });
  } catch(e){
    console.error('[annonces] ajout échoué', e);
    return res.status(500).json({ error:'Impossible d\'ajouter annonce' });
  }
});

// PUT mise à jour
app.put('/api/annonces/:id', (req,res)=>{
  try {
    console.log('[HTTP PUT /api/annonces/'+req.params.id+'] body=', req.body);
    ensureAnnoncesFile();
    const id = req.params.id;
    const list = JSON.parse(fs.readFileSync(annoncesFile,'utf8')||'[]');
    const idx = list.findIndex(a=>a.id===id);
    if(idx === -1) return res.status(404).json({ error:'Annonce non trouvée' });
    const prev = list[idx];
    const body = req.body || {};
    list[idx] = {
      ...prev,
      titre: body.titre?.toString().slice(0,140) || prev.titre,
      message: body.message? body.message.toString().slice(0,4000): prev.message,
      produits: Array.isArray(body.produits)? body.produits.slice(0,20): (prev.produits || []),
      medias: Array.isArray(body.medias)? body.medias.slice(0,10): prev.medias,
      lien: typeof body.lien === 'undefined'? prev.lien : body.lien,
      dateMaj: new Date().toISOString()
    };
    fs.writeFileSync(annoncesFile, JSON.stringify(list,null,2));
    return res.json({ success:true, entry:list[idx] });
  } catch(e){
    console.error('[annonces] update échouée', e);
    return res.status(500).json({ error:'Impossible de mettre à jour annonce' });
  }
});

// DELETE annonce
app.delete('/api/annonces/:id', (req,res)=>{
  try {
    ensureAnnoncesFile();
    const id = req.params.id;
    const list = JSON.parse(fs.readFileSync(annoncesFile,'utf8')||'[]');
    const filtered = list.filter(a=>a.id!==id);
    if(filtered.length === list.length) return res.status(404).json({ error:'Annonce non trouvée' });
    fs.writeFileSync(annoncesFile, JSON.stringify(filtered,null,2));
    return res.json({ success:true, removed:id });
  } catch(e){
    console.error('[annonces] suppression échouée', e);
    return res.status(500).json({ error:'Impossible de supprimer annonce' });
  }
});

// ---- Messages Avis ----
const messagesAvisFile = path.join(__dirname, 'messages-Avis.json');

function ensureMessagesAvisFile() {
  if (!fs.existsSync(messagesAvisFile)) {
    fs.writeFileSync(messagesAvisFile, '[]', 'utf8');
  }
}

// GET messages-Avis
app.get('/api/messages-Avis', (req, res) => {
  try {
    ensureMessagesAvisFile();
    const raw = fs.readFileSync(messagesAvisFile, 'utf8');
    return res.json(JSON.parse(raw || '[]'));
  } catch (e) {
    console.error('[messages-Avis] lecture échouée', e);
    return res.status(500).json({ error: 'Impossible de lire messages-Avis' });
  }
});

// ---- Page Infos personnalisée ----
// GET page infos
app.get('/api/info-page', (req, res) => {
  try {
    ensureInfosPageFile();
    const raw = fs.readFileSync(infosPageFile, 'utf8');
    return res.json(JSON.parse(raw || '{"elements":[]}'));
  } catch (e) {
    console.error('[info-page] lecture échouée', e);
    return res.status(500).json({ error: 'Impossible de lire la page infos' });
  }
});

// PUT mise à jour page infos
app.put('/api/info-page', (req, res) => {
  try {
    ensureInfosPageFile();
    const body = req.body || {};
    const elements = Array.isArray(body.elements) ? body.elements : [];
    const sommaire = body.sommaire || { visible: true, items: [] };
    const data = { elements, sommaire };
    fs.writeFileSync(infosPageFile, JSON.stringify(data, null, 2));
    console.log('[info-page] Page sauvegardée avec', elements.length, 'éléments et', sommaire.items?.length || 0, 'sections sommaire');
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[info-page] sauvegarde échouée', e);
    return res.status(500).json({ error: 'Impossible de sauvegarder la page infos' });
  }
});

// Lancer le serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
  console.log(`- Interface admin: http://localhost:${PORT}/admin.html`);
  console.log(`- Boutique: http://localhost:${PORT}/index.html`);
});