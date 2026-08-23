const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const CHUNKS_DIR = path.join(DATA_DIR, 'chunks');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Ensure directories exist
[DATA_DIR, UPLOADS_DIR, CHUNKS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// Default DB structure
const DEFAULT_DB = {
  users: [],
  presentacion: [],
  packs: {},
  covers: {},
  pendingOrders: [],
  library: {},
  tokens: {}
};

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return { ...DEFAULT_DB, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
    }
  } catch (e) {
    console.error('Error loading DB:', e.message);
  }
  return { ...DEFAULT_DB };
}

function saveDB(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('Error saving DB:', e.message);
  }
}

let db = loadDB();

// Moderators (same as original)
const MODS = [
  'nicolasamadeo34@gmail.com',
  'nicolásamadeo34@gmail.com',
  'antonellaiodati39@gmail.com'
];
const MODPASS = 'Amadeo2010';

function clean(e) {
  return (e || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function isMod(email) {
  return MODS.some(m => clean(m) === clean(email));
}

// Seed moderators
function seedMods() {
  MODS.forEach(em => {
    const found = db.users.find(u => clean(u.email) === clean(em));
    if (!found) {
      db.users.push({
        id: uuidv4(),
        name: 'Moderador',
        email: em,
        password: hashPass(MODPASS),
        isMod: true,
        createdAt: new Date().toISOString()
      });
    } else {
      found.password = hashPass(MODPASS);
      found.isMod = true;
    }
  });
  saveDB(db);
}
seedMods();

function hashPass(p) {
  return crypto.createHash('sha256').update(p + 'creatorhub_salt').digest('hex');
}

function createToken(user) {
  const token = crypto.randomBytes(32).toString('hex');
  db.tokens[token] = {
    userId: user.id,
    email: user.email,
    isMod: user.isMod || isMod(user.email),
    createdAt: Date.now()
  };
  saveDB(db);
  return token;
}

function getUserFromToken(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token || !db.tokens[token]) return null;
  const t = db.tokens[token];
  // Tokens valid for 30 days
  if (Date.now() - t.createdAt > 30 * 24 * 60 * 60 * 1000) {
    delete db.tokens[token];
    saveDB(db);
    return null;
  }
  const user = db.users.find(u => u.id === t.userId);
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isMod: user.isMod || isMod(user.email)
  };
}

function requireAuth(req, res, next) {
  const user = getUserFromToken(req);
  if (!user) return res.status(401).json({ error: 'No autorizado' });
  req.user = user;
  next();
}

function requireMod(req, res, next) {
  const user = getUserFromToken(req);
  if (!user || !user.isMod) return res.status(403).json({ error: 'Solo moderadores' });
  req.user = user;
  next();
}

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || (file.mimetype.startsWith('video/') ? '.mp4' : '.jpg');
    cb(null, `${Date.now()}-${uuidv4().slice(0, 8)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB; las subidas mayores requieren carga por partes
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo imágenes y videos'));
    }
  }
});
const chunkUpload = multer({
  dest: CHUNKS_DIR,
  limits: { fileSize: 12 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploads (public for covers/pres, protected for packs via API)
app.use('/uploads', express.static(UPLOADS_DIR));

// ——— AUTH ———
app.post('/api/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Completá todos los campos' });
  if (password.length < 6) return res.status(400).json({ error: 'Contraseña mínimo 6 caracteres' });
  const em = email.trim().toLowerCase();
  if (db.users.find(u => clean(u.email) === clean(em))) {
    return res.status(400).json({ error: 'Ese email ya está registrado' });
  }
  const user = {
    id: uuidv4(),
    name: name.trim(),
    email: em,
    password: hashPass(password),
    isMod: isMod(em),
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  saveDB(db);
  const token = createToken(user);
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, isMod: user.isMod }
  });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Ingresá tus datos' });
  const em = email.trim().toLowerCase();
  const user = db.users.find(u => clean(u.email) === clean(em));
  if (!user || user.password !== hashPass(password)) {
    // Allow mod login with hardcoded pass even if not registered yet
    if (isMod(em) && password === MODPASS) {
      let modUser = user;
      if (!modUser) {
        modUser = {
          id: uuidv4(),
          name: 'Moderador',
          email: em,
          password: hashPass(MODPASS),
          isMod: true,
          createdAt: new Date().toISOString()
        };
        db.users.push(modUser);
        saveDB(db);
      }
      const token = createToken(modUser);
      return res.json({
        token,
        user: { id: modUser.id, name: modUser.name, email: modUser.email, isMod: true }
      });
    }
    return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  }
  const token = createToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      isMod: user.isMod || isMod(user.email)
    }
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/logout', requireAuth, (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token && db.tokens[token]) {
    delete db.tokens[token];
    saveDB(db);
  }
  res.json({ ok: true });
});

// ——— PRESENTACIÓN ———
app.get('/api/presentacion', (req, res) => {
  res.json({ items: db.presentacion || [] });
});

app.post('/api/presentacion', requireMod, upload.array('files', 20), (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Seleccioná al menos una foto' });
  files.forEach(f => {
    db.presentacion.push('/uploads/' + f.filename);
  });
  saveDB(db);
  res.json({ items: db.presentacion });
});

app.delete('/api/presentacion/:index', requireMod, (req, res) => {
  const i = parseInt(req.params.index);
  if (isNaN(i) || i < 0 || i >= db.presentacion.length) {
    return res.status(400).json({ error: 'Índice inválido' });
  }
  const removed = db.presentacion.splice(i, 1)[0];
  // Try to delete file
  if (removed && removed.startsWith('/uploads/')) {
    const fp = path.join(UPLOADS_DIR, path.basename(removed));
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {}
  }
  saveDB(db);
  res.json({ items: db.presentacion });
});

app.delete('/api/presentacion', requireMod, (req, res) => {
  (db.presentacion || []).forEach(src => {
    if (src && src.startsWith('/uploads/')) {
      const fp = path.join(UPLOADS_DIR, path.basename(src));
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {}
    }
  });
  db.presentacion = [];
  saveDB(db);
  res.json({ items: [] });
});

// ——— COVERS ———
app.get('/api/covers', (req, res) => {
  res.json({ covers: db.covers || {} });
});

app.post('/api/covers', requireMod, upload.array('files', 6), (req, res) => {
  const chan = req.body.channel;
  const files = req.files || [];
  if (!chan || !files.length) return res.status(400).json({ error: 'Canal e imagen requeridos' });
  if (chan === 'home') {
    db.covers[chan] = files.map(file => '/uploads/' + file.filename);
  } else {
    db.covers[chan] = '/uploads/' + files[0].filename;
  }
  saveDB(db);
  res.json({ covers: db.covers });
});

// ——— PACKS ———
function isVideoSrc(src) {
  if (!src) return false;
  return src.startsWith('data:video') || /\.(mp4|webm|mov|ogg|m4v)(\?|$)/i.test(src);
}

app.get('/api/packs', (req, res) => {
  // Public list: metadata + cover only. Full media only for owners / moderators.
  const user = getUserFromToken(req);
  const email = user ? clean(user.email) : null;
  const lib = email ? (db.library[email] || []) : [];
  const result = {};
  Object.keys(db.packs || {}).forEach(n => {
    const p = db.packs[n];
    if (!p || !p.media || !p.media.length) return;
    const cover = p.media[p.coverIndex || 0] || p.media[0];
    const owns = user && (user.isMod || lib.some(i => i.id === `pack-${n}`));
    const fotos = p.media.filter(m => !isVideoSrc(m)).length;
    const videos = p.media.length - fotos;
    result[n] = {
      name: p.name,
      category: p.category || 'solita',
      price: p.price,
      currency: p.currency || 'ARS',
      coverIndex: p.coverIndex || 0,
      cover,
      mediaCount: p.media.length,
      fotos,
      videos,
      media: (owns || (user && user.isMod)) ? p.media : undefined
    };
  });
  res.json({ packs: result });
});

app.get('/api/packs/:slot', requireAuth, (req, res) => {
  const n = req.params.slot;
  const pack = db.packs[n];
  if (!pack) return res.status(404).json({ error: 'Pack no encontrado' });

  // Check if user owns it
  const email = clean(req.user.email);
  const lib = db.library[email] || [];
  const owns = lib.some(i => i.id === `pack-${n}`) || req.user.isMod;
  if (!owns) return res.status(403).json({ error: 'No compraste este pack' });

  res.json({ pack });
});

app.post('/api/packs/upload-chunk', requireMod, chunkUpload.single('chunk'), (req, res) => {
  const uploadId = String(req.body.uploadId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const index = Number(req.body.index);
  const total = Number(req.body.total);
  if (!req.file || !uploadId || !Number.isInteger(index) || !Number.isInteger(total) || index < 0 || index >= total || total < 1) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Parte de video inválida' });
  }

  const chunkPath = path.join(CHUNKS_DIR, `${uploadId}-${index}`);
  fs.renameSync(req.file.path, chunkPath);
  if (index !== total - 1) return res.json({ ok: true, complete: false });

  const extension = path.extname(String(req.body.filename || 'video.mp4')) || '.mp4';
  const filename = `${Date.now()}-${uuidv4().slice(0, 8)}${extension}`;
  const finalPath = path.join(UPLOADS_DIR, filename);
  try {
    for (let part = 0; part < total; part++) {
      const partPath = path.join(CHUNKS_DIR, `${uploadId}-${part}`);
      if (!fs.existsSync(partPath)) throw new Error('Falta una parte del video');
      fs.appendFileSync(finalPath, fs.readFileSync(partPath));
      fs.unlinkSync(partPath);
    }
  } catch (e) {
    try { fs.unlinkSync(finalPath); } catch (ignore) {}
    return res.status(400).json({ error: e.message });
  }
  res.json({ ok: true, complete: true, url: '/uploads/' + filename });
});

app.post('/api/packs/merge', requireMod, (req, res) => {
  const sourceSlots = Array.isArray(req.body.sourceSlots)
    ? [...new Set(req.body.sourceSlots.map(Number).filter(n => n >= 1 && n <= 200))]
    : [];
  const targetSlot = Number(req.body.targetSlot);
  if (sourceSlots.length < 2) return res.status(400).json({ error: 'Seleccioná al menos 2 slots de origen' });
  if (!Number.isInteger(targetSlot) || targetSlot < 1 || targetSlot > 200) {
    return res.status(400).json({ error: 'El slot destino debe estar entre 1 y 200' });
  }
  if (sourceSlots.includes(targetSlot)) return res.status(400).json({ error: 'El slot destino debe ser distinto a los slots de origen' });

  const missing = sourceSlots.filter(slot => !db.packs[slot] || !db.packs[slot].media || !db.packs[slot].media.length);
  if (missing.length) return res.status(404).json({ error: 'No hay archivos en los slots: ' + missing.join(', ') });

  const firstPack = db.packs[sourceSlots[0]];
  const media = [...new Set(sourceSlots.flatMap(slot => db.packs[slot].media))];
  db.packs[targetSlot] = {
    name: String(req.body.name || `Pack unido #${targetSlot}`).trim(),
    category: firstPack.category || 'solita',
    price: Number(firstPack.price) || 0,
    currency: firstPack.currency || 'ARS',
    media,
    coverIndex: 0
  };
  saveDB(db);
  res.json({ pack: db.packs[targetSlot], slot: targetSlot });
});

app.post('/api/packs/:slot', requireMod, upload.array('files', 50), (req, res) => {
  const n = parseInt(req.params.slot);
  if (!n || n < 1 || n > 200) return res.status(400).json({ error: 'Slot inválido (1-200)' });

  const name = (req.body.name || `Pack #${n}`).trim();
  const category = req.body.category === 'acompanada' ? 'acompanada' : 'solita';
  const price = parseFloat(req.body.price) || 0;
  const currency = req.body.currency || 'ARS';
  let coverIndex = parseInt(req.body.coverIndex);
  if (isNaN(coverIndex)) coverIndex = 0;

  let media = [];
  // Keep existing if appending
  if (req.body.keepExisting === 'true' && db.packs[n] && db.packs[n].media) {
    media = db.packs[n].media.slice();
  }

  // URLs from body
  if (req.body.urls) {
    try {
      const urls = typeof req.body.urls === 'string' ? JSON.parse(req.body.urls) : req.body.urls;
      if (Array.isArray(urls)) media = media.concat(urls.filter(Boolean));
    } catch (e) {}
  }

  // Uploaded files
  (req.files || []).forEach(f => {
    media.push('/uploads/' + f.filename);
  });

  if (!media.length) return res.status(400).json({ error: 'Agregá al menos un archivo' });
  if (coverIndex >= media.length) coverIndex = 0;

  db.packs[n] = { name, category, price, currency, media, coverIndex };
  saveDB(db);
  res.json({ pack: db.packs[n], slot: n });
});

app.delete('/api/packs/:slot', requireMod, (req, res) => {
  const n = req.params.slot;
  const pack = db.packs[n];
  if (pack && pack.media) {
    pack.media.forEach(src => {
      if (src && src.startsWith('/uploads/')) {
        const fp = path.join(UPLOADS_DIR, path.basename(src));
        try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {}
      }
    });
  }
  delete db.packs[n];
  saveDB(db);
  res.json({ ok: true });
});

// ——— ORDERS ———
app.post('/api/orders', (req, res) => {
  const { name, items, total } = req.body;
  const currentUser = getUserFromToken(req);
  if (!name || !items || !items.length) return res.status(400).json({ error: 'Nombre y productos son requeridos' });
  const order = {
    id: 'ord_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name: name.trim(),
    email: currentUser ? currentUser.email : '',
    items,
    total: Number(total) || 0,
    status: 'pending',
    date: new Date().toISOString(),
    dateStr: new Date().toLocaleString('es-AR')
  };
  db.pendingOrders.unshift(order);
  saveDB(db);
  res.json({ order });
});

app.get('/api/orders', requireMod, (req, res) => {
  res.json({ orders: db.pendingOrders || [] });
});

app.post('/api/orders/:id/approve', requireMod, (req, res) => {
  const ord = db.pendingOrders.find(o => o.id === req.params.id);
  if (!ord) return res.status(404).json({ error: 'Pedido no encontrado' });
  ord.status = 'approved';
  const accessKey = clean(ord.email || ord.phone || ord.name);
  if (!db.library[accessKey]) db.library[accessKey] = [];
  ord.items.forEach(it => {
    db.library[accessKey].push({ ...it, approvedAt: new Date().toISOString() });
  });
  saveDB(db);
  res.json({ order: ord });
});

app.post('/api/orders/:id/reject', requireMod, (req, res) => {
  const ord = db.pendingOrders.find(o => o.id === req.params.id);
  if (!ord) return res.status(404).json({ error: 'Pedido no encontrado' });
  ord.status = 'rejected';
  saveDB(db);
  res.json({ order: ord });
});

// ——— LIBRARY ———
app.get('/api/library', requireAuth, (req, res) => {
  const email = clean(req.user.email);
  const items = db.library[email] || [];
  res.json({ items });
});

// ——— TELEGRAM LINKS (public constants, unlock checked client-side via library) ———
app.get('/api/config', (req, res) => {
  res.json({
    tg: {
      gratis: 'https://t.me/aguitademujer',
      'vip-solita': 'https://t.me/+Ur-tduoXkKo4ZTYx',
      'vip-acompanada': 'https://t.me/+7lRu2Axtn2ZmMTQx'
    },
    wa: 'https://wa.me/5491139129443'
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'El video supera el máximo permitido de 500 MB. Los videos mayores requieren carga por partes.' });
  }
  if (err) return res.status(400).json({ error: err.message || 'No se pudo subir el archivo' });
  next();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CreatorHub running on port ${PORT}`);
});
