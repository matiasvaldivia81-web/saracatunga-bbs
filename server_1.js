/**
 * SARACATUNGA BBS - Backend v2.0
 * Stack: Express + sql.js (SQLite en memoria/archivo) + JWT + bcryptjs
 * Autor: by MV
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'saracatunga_secret_mv_2024';
// Usar /data si existe (Render con disco), sino usar directorio actual
const DB_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const DB_PATH = path.join(DB_DIR, 'saracatunga.db');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// Servir frontend - busca index.html en /public o en la raíz
const publicPath = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : __dirname;
app.use(express.static(publicPath));

// ═══════════════════════════════════════════════
// DATABASE INIT
// ═══════════════════════════════════════════════
let db;

async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('✔ DB cargada desde archivo');
  } else {
    db = new SQL.Database();
    console.log('✔ DB nueva creada en memoria');
  }

  // Schema
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      email TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      stars INTEGER DEFAULT 3,
      blocked INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      posts_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      category TEXT NOT NULL,
      author_id INTEGER NOT NULL,
      votes INTEGER DEFAULT 0,
      pinned INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      last_activity_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (author_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      votes INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (topic_id) REFERENCES topics(id),
      FOREIGN KEY (author_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      UNIQUE(user_id, target_type, target_id)
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER NOT NULL,
      target_user_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      detail TEXT,
      status TEXT DEFAULT 'pendiente',
      resolved_by INTEGER,
      resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Crear usuario MASTER si no existe
  const existing = db.exec("SELECT id FROM users WHERE username = 'MV01'");
  if (!existing.length || !existing[0].values.length) {
    const hash = bcrypt.hashSync('Vega678merlo', 10);
    db.run(`INSERT INTO users (username, email, password_hash, role, stars) VALUES (?, ?, ?, 'master', 3)`,
      ['MV01', 'matiasvaldivia81@gmail.com', hash]);
    console.log('✔ Usuario MASTER creado: MV01');
  }

  // SYSOP demo secundario
  const sysop = db.exec("SELECT id FROM users WHERE username = 'SYSOP'");
  if (!sysop.length || !sysop[0].values.length) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.run(`INSERT INTO users (username, email, password_hash, role, stars) VALUES (?, ?, ?, 'mod', 3)`,
      ['SYSOP', 'sysop@saracatunga.bbs', hash]);
  }

  // Seed data si la tabla topics está vacía
  const topicsCheck = db.exec('SELECT COUNT(*) as c FROM topics');
  if (topicsCheck[0].values[0][0] === 0) {
    seedData();
  }

  // Migración: agregar last_activity_at si no existe (DBs viejas)
  try {
    db.run(`ALTER TABLE topics ADD COLUMN last_activity_at TEXT DEFAULT (datetime('now'))`);
    // Inicializar con created_at para temas existentes
    db.run(`UPDATE topics SET last_activity_at = created_at WHERE last_activity_at IS NULL`);
    console.log('✔ Migración: last_activity_at agregado');
  } catch(e) { /* columna ya existe, ok */ }

  // Migración: agregar status/resolved a reports
  try {
    db.run(`ALTER TABLE reports ADD COLUMN status TEXT DEFAULT 'pendiente'`);
    db.run(`ALTER TABLE reports ADD COLUMN resolved_by INTEGER`);
    db.run(`ALTER TABLE reports ADD COLUMN resolved_at TEXT`);
    console.log('✔ Migración: reports status agregado');
  } catch(e) { /* columnas ya existen, ok */ }

  // Migración: corregir título del tema de bienvenida si tiene "BBS"
  try {
    db.run(`UPDATE topics SET title='Bienvenidos a SARACATUNGA — Leé esto antes de arrancar',
      body='Este es el foro donde los humanos debaten sin algoritmos, sin IA, sin filtros.\n\nOpiniones reales de personas reales. Sin burbujas, sin que nadie te diga qué pensar.\n\nReglas básicas:\n— Argumentá con datos, no con insultos\n— El desacuerdo es bienvenido, el acoso no\n— Cada usuario empieza con ★★★. Las denuncias aceptadas quitan estrellas\n— A 0★ la cuenta queda bloqueada\n\nSi tenés algo para decir, este es el lugar.'
      WHERE title LIKE '%BBS%' AND pinned=1`);
  } catch(e) { /* ok */ }

  saveDB();
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Guardar DB cada 30 segundos
setInterval(saveDB, 30000);

function seedData() {
  const hash = bcrypt.hashSync('pass123', 10);
  db.run(`INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, 'user')`,
    ['NEUTRINO_77', 'n@bbs.com', hash]);
  db.run(`INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, 'user')`,
    ['BYTERUNNER', 'b@bbs.com', hash]);

  // Tema fijado de bienvenida
  db.run(`INSERT INTO topics (title, body, category, author_id, pinned) VALUES (?, ?, ?, 1, 1)`, [
    'Bienvenidos a SARACATUNGA — Leé esto antes de arrancar',
    'Este es el foro donde los humanos debaten sin algoritmos, sin IA, sin filtros.\n\nOpiniones reales de personas reales. Sin burbujas, sin que nadie te diga qué pensar.\n\nReglas básicas:\n— Argumentá con datos, no con insultos\n— El desacuerdo es bienvenido, el acoso no\n— Cada usuario empieza con ★★★. Las denuncias aceptadas quitan estrellas\n— A 0★ la cuenta queda bloqueada\n\nSi tenés algo para decir, este es el lugar.',
    'General'
  ]);

  // 1. Política / Actualidad
  db.run(`INSERT INTO topics (title, body, category, author_id) VALUES (?, ?, ?, 1)`, [
    'Milei y el ajuste: ¿está funcionando o nos están mintiendo con los números?',
    'El gobierno muestra superávit fiscal y baja de inflación. Pero en la calle los precios no bajan y el salario real sigue cayendo. ¿Quién tiene razón: los datos macro o la experiencia cotidiana? ¿Es posible que ambas cosas sean ciertas al mismo tiempo?\n\nDebatamos con datos concretos, no con chicanas.',
    'Politica'
  ]);

  // 2. Actualidad
  db.run(`INSERT INTO topics (title, body, category, author_id) VALUES (?, ?, ?, 1)`, [
    'El dólar blue: ¿por qué el gobierno no puede eliminarlo de una vez?',
    'Llevamos décadas con brecha cambiaria en Argentina. Cada gobierno promete terminar con el mercado paralelo y ninguno puede. ¿Es un problema político, económico o cultural? ¿La gente seguiría comprando dólares aunque no hubiera cepo?',
    'General'
  ]);

  // 3. Autos
  db.run(`INSERT INTO topics (title, body, category, author_id) VALUES (?, ?, ?, 1)`, [
    'Autos eléctricos en Argentina: ¿tiene sentido comprar uno hoy?',
    'Con la infraestructura de carga que tenemos, los cortes de luz, y el precio de importación disparado... ¿es viable tener un auto eléctrico en Argentina en 2024? ¿O es un lujo para pocos que además no tiene sentido práctico fuera de Capital?\n\nTengo ganas de comprar uno pero no sé si me estoy haciendo el boludo.',
    'General'
  ]);

  // 4. Autos
  db.run(`INSERT INTO topics (title, body, category, author_id) VALUES (?, ?, ?, 1)`, [
    'GNC vs nafta vs eléctrico: cuál conviene en Argentina hoy con estos precios',
    'Hice los números con mi auto actual y me sale casi lo mismo con GNC que con nafta premium una vez que sumás el costo de la conversión y el mantenimiento. Alguien más hizo este análisis? Qué variables usaron?\n\nPongan sus cuentas acá para comparar.',
    'General'
  ]);

  // 5. Emprendedorismo
  db.run(`INSERT INTO topics (title, body, category, author_id) VALUES (?, ?, ?, 1)`, [
    'Emprender en Argentina 2024: ¿heroísmo o masoquismo?',
    'Impuestos altísimos, tipo de cambio impredecible, consumo cayendo, crédito imposible. Y sin embargo hay gente que arranca negocios y le va bien. ¿Qué sectores están funcionando? ¿Cuál es el secreto de los que sobreviven?\n\nComparto mi experiencia: arranqué una pequeña distribuidora hace 8 meses y voy a contar qué aprendí.',
    'General'
  ]);

  // 6. Emprendedorismo
  db.run(`INSERT INTO topics (title, body, category, author_id) VALUES (?, ?, ?, 1)`, [
    'Factura A vs Monotributo: el dilema que no te enseñan en ningún lado',
    'Llegué al tope de monotributo y tengo que decidir si paso a responsable inscripto o abro una SRL. Consulté con tres contadores y me dieron tres respuestas distintas. ¿Alguien pasó por esto? ¿Cómo lo resolvieron?\n\nTambién: ¿vale la pena una sociedad con socios para bajar la carga impositiva?',
    'General'
  ]);

  // 7. Tecnología
  db.run(`INSERT INTO topics (title, body, category, author_id) VALUES (?, ?, ?, 1)`, [
    'Trabajar en IT desde Argentina para el exterior: la realidad después del boom',
    'En 2021-2022 parecía que cualquiera con conocimientos básicos de programación conseguía trabajo remoto en dólares. Ahora el mercado se enfría, hay layoffs globales y más competencia. ¿Cómo está el mercado realmente hoy? ¿Qué stack conviene aprender?',
    'Tecnologia'
  ]);

  // 8. Cultura / Debate
  db.run(`INSERT INTO topics (title, body, category, author_id) VALUES (?, ?, ?, 1)`, [
    'La grieta argentina: ¿existe realmente o nos la inventaron para que no nos juntemos?',
    'Cada vez que hablo con gente "del otro lado" políticamente, en persona, llegamos a más acuerdos que desacuerdos. Pero en redes sociales parece que somos enemigos irreconciliables. ¿La polarización es real o es un producto de los algoritmos y los medios?\n\n¿Cuándo fue la última vez que cambiaste de opinión sobre algo político importante?',
    'Politica'
  ]);

  // 9. Actualidad / Economía
  db.run(`INSERT INTO topics (title, body, category, author_id) VALUES (?, ?, ?, 1)`, [
    'Alquileres en Argentina: la nueva ley ¿ayudó o empeoró todo?',
    'Derogaron la ley de alquileres anterior y volvieron a contratos más cortos. Los propietarios dicen que ahora ofrecen más inmuebles. Los inquilinos dicen que los precios se dispararon igual. ¿Quién tiene razón? ¿Cuál es tu experiencia concreta como propietario o inquilino?',
    'General'
  ]);

  // 10. Emprendedorismo / Autos
  db.run(`INSERT INTO topics (title, body, category, author_id) VALUES (?, ?, ?, 1)`, [
    'Uber, Cabify, inDriver: ¿conviene manejar en 2024 o es trampa?',
    'Un amigo dice que le salen los números manejando 8 horas por día. Otro dice que cuando sumás nafta, mantenimiento, seguro y el desgaste del auto, estás trabajando gratis. ¿Alguien tiene números reales? ¿En qué ciudad? ¿Con qué auto?\n\nTambién: ¿InDriver es mejor que Uber para el conductor?',
    'General'
  ]);

  console.log('✔ 10 temas iniciales insertados');
}

// ═══════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════
function query(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  } catch (e) {
    console.error('Query error:', e.message, sql);
    return [];
  }
}

function run(sql, params = []) {
  try {
    db.run(sql, params);
    // Get last insert id
    const r = db.exec('SELECT last_insert_rowid() as id');
    return r[0]?.values[0][0] || null;
  } catch (e) {
    console.error('Run error:', e.message);
    throw e;
  }
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function modMiddleware(req, res, next) {
  if (!['mod', 'master', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Requiere permisos de moderador' });
  }
  next();
}

function masterMiddleware(req, res, next) {
  if (req.user.role !== 'master') {
    return res.status(403).json({ error: 'Solo el usuario MASTER puede hacer esto' });
  }
  next();
}

function fmtUser(u) {
  return {
    id: u.id, username: u.username, email: u.email,
    role: u.role, stars: u.stars, blocked: !!u.blocked,
    created_at: u.created_at, posts_count: u.posts_count
  };
}

// ═══════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'Campos incompletos' });
  if (username.length < 3 || username.length > 25)
    return res.status(400).json({ error: 'Usuario: 3-25 caracteres' });
  if (!/^[a-zA-Z0-9_]+$/.test(username))
    return res.status(400).json({ error: 'Solo letras, números y guion bajo' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Contraseña mínimo 6 caracteres' });

  const existing = query('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
  if (existing.length) return res.status(409).json({ error: 'Usuario o email ya existe' });

  const hash = bcrypt.hashSync(password, 10);
  try {
    const id = run('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      [username.toUpperCase(), email.toLowerCase(), hash]);
    saveDB();
    const user = query('SELECT * FROM users WHERE id = ?', [id])[0];
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: fmtUser(user) });
  } catch (e) {
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const users = query('SELECT * FROM users WHERE username = ?', [username?.toUpperCase()]);
  if (!users.length) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  const user = users[0];
  if (!bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: fmtUser(user) });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const users = query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!users.length) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(fmtUser(users[0]));
});

// ═══════════════════════════════════════════════
// USER ROUTES
// ═══════════════════════════════════════════════
app.get('/api/users', authMiddleware, modMiddleware, (req, res) => {
  const users = query('SELECT id, username, email, role, stars, blocked, created_at, posts_count FROM users ORDER BY created_at DESC');
  res.json(users.map(u => ({ ...u, blocked: !!u.blocked })));
});

app.get('/api/users/:id', (req, res) => {
  const users = query('SELECT id, username, role, stars, blocked, created_at, posts_count FROM users WHERE id = ?', [req.params.id]);
  if (!users.length) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ ...users[0], blocked: !!users[0].blocked });
});

// Promover usuario a mod (solo master)
app.post('/api/users/:id/promote', authMiddleware, masterMiddleware, (req, res) => {
  const { role } = req.body; // 'mod' | 'user' | 'admin'
  const validRoles = ['user', 'mod', 'admin'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  run('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
  saveDB();
  res.json({ success: true, message: `Usuario actualizado a ${role}` });
});

// Restaurar estrella a usuario bloqueado (mod+)
app.post('/api/users/:id/restore-star', authMiddleware, modMiddleware, (req, res) => {
  const users = query('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!users.length) return res.status(404).json({ error: 'Usuario no encontrado' });
  const u = users[0];
  const newStars = Math.min(3, u.stars + 1);
  run('UPDATE users SET stars = ?, blocked = 0 WHERE id = ?', [newStars, u.id]);
  saveDB();
  res.json({ success: true, stars: newStars, message: `Estrella restaurada a ${u.username}` });
});

// Bloqueo directo (mod+)
app.post('/api/users/:id/block', authMiddleware, modMiddleware, (req, res) => {
  run('UPDATE users SET blocked = 1, stars = 0 WHERE id = ?', [req.params.id]);
  saveDB();
  res.json({ success: true });
});

// ═══════════════════════════════════════════════
// TOPICS
// ═══════════════════════════════════════════════
app.get('/api/topics', (req, res) => {
  const { cat, q } = req.query;
  let sql = `
    SELECT t.*, u.username as author_name, u.role as author_role, u.stars as author_stars, u.blocked as author_blocked,
           COUNT(DISTINCT c.id) as comment_count,
           t.last_activity_at,
           -- Score: votos x3 + comentarios x2 + boost por actividad reciente
           -- Horas desde última actividad (mínimo 0.5 para evitar division por cero)
           (t.votes * 3.0 + COUNT(DISTINCT c.id) * 2.0 +
            20.0 / (MAX(0.5, CAST((julianday('now') - julianday(COALESCE(t.last_activity_at, t.created_at))) * 24 AS REAL)) + 1)
           ) as activity_score
    FROM topics t
    JOIN users u ON t.author_id = u.id
    LEFT JOIN comments c ON c.topic_id = t.id
    WHERE 1=1
  `;
  const params = [];
  if (cat) { sql += ' AND t.category = ?'; params.push(cat); }
  if (q) { sql += ' AND (t.title LIKE ? OR t.body LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  // Fijados siempre arriba, luego por score de actividad
  sql += ' GROUP BY t.id ORDER BY t.pinned DESC, activity_score DESC';
  res.json(query(sql, params));
});

app.get('/api/topics/:id', (req, res) => {
  const topics = query(`
    SELECT t.*, u.username as author_name, u.role as author_role, u.stars as author_stars, u.blocked as author_blocked
    FROM topics t JOIN users u ON t.author_id = u.id WHERE t.id = ?
  `, [req.params.id]);
  if (!topics.length) return res.status(404).json({ error: 'Tema no encontrado' });
  res.json(topics[0]);
});

app.post('/api/topics', authMiddleware, (req, res) => {
  const user = query('SELECT * FROM users WHERE id = ?', [req.user.id])[0];
  if (!user || user.blocked) return res.status(403).json({ error: 'Cuenta bloqueada' });
  const { title, body, category } = req.body;
  if (!title || !body || !category) return res.status(400).json({ error: 'Campos incompletos' });
  if (title.length < 15) return res.status(400).json({ error: 'Título mínimo 15 caracteres' });
  if (body.length < 30) return res.status(400).json({ error: 'Cuerpo mínimo 30 caracteres' });
  const validCats = ['General','Politica','Tecnologia','Cultura','Ciencia','Deporte','Humor','Off-Topic','Varios'];
  if (!validCats.includes(category)) return res.status(400).json({ error: 'Categoría inválida' });

  const id = run('INSERT INTO topics (title, body, category, author_id) VALUES (?, ?, ?, ?)',
    [title, body, category, user.id]);
  run('UPDATE users SET posts_count = posts_count + 1 WHERE id = ?', [user.id]);
  saveDB();
  const topic = query('SELECT t.*, u.username as author_name FROM topics t JOIN users u ON t.author_id=u.id WHERE t.id=?', [id])[0];
  res.status(201).json(topic);
});

app.delete('/api/topics/:id', authMiddleware, (req, res) => {
  const user = query('SELECT * FROM users WHERE id = ?', [req.user.id])[0];
  const topic = query('SELECT * FROM topics WHERE id = ?', [req.params.id])[0];
  if (!topic) return res.status(404).json({ error: 'Tema no encontrado' });
  if (topic.author_id !== user.id && !['mod','master','admin'].includes(user.role))
    return res.status(403).json({ error: 'Sin permisos' });
  run('DELETE FROM topics WHERE id = ?', [req.params.id]);
  run('DELETE FROM comments WHERE topic_id = ?', [req.params.id]);
  saveDB();
  res.json({ success: true });
});

// Pin/unpin (mod+)
app.post('/api/topics/:id/pin', authMiddleware, modMiddleware, (req, res) => {
  const topic = query('SELECT * FROM topics WHERE id = ?', [req.params.id])[0];
  if (!topic) return res.status(404).json({ error: 'Tema no encontrado' });
  run('UPDATE topics SET pinned = ? WHERE id = ?', [topic.pinned ? 0 : 1, req.params.id]);
  saveDB();
  res.json({ success: true, pinned: !topic.pinned });
});

// Votar tema
app.post('/api/topics/:id/vote', authMiddleware, (req, res) => {
  const uid = req.user.id;
  const tid = req.params.id;
  const existing = query('SELECT id FROM votes WHERE user_id=? AND target_type=? AND target_id=?', [uid,'topic',tid]);
  if (existing.length) {
    run('DELETE FROM votes WHERE user_id=? AND target_type=? AND target_id=?', [uid,'topic',tid]);
    run('UPDATE topics SET votes = votes - 1 WHERE id = ?', [tid]);
    saveDB();
    return res.json({ voted: false });
  }
  run('INSERT INTO votes (user_id, target_type, target_id) VALUES (?,?,?)', [uid,'topic',tid]);
  run('UPDATE topics SET votes = votes + 1, last_activity_at = datetime(\'now\') WHERE id = ?', [tid]);
  saveDB();
  res.json({ voted: true });
});

// ═══════════════════════════════════════════════
// COMMENTS
// ═══════════════════════════════════════════════
app.get('/api/topics/:id/comments', (req, res) => {
  const cmts = query(`
    SELECT c.*, u.username as author_name, u.role as author_role, u.stars as author_stars, u.blocked as author_blocked
    FROM comments c JOIN users u ON c.author_id = u.id
    WHERE c.topic_id = ? ORDER BY c.created_at ASC
  `, [req.params.id]);
  res.json(cmts);
});

app.post('/api/topics/:id/comments', authMiddleware, (req, res) => {
  const user = query('SELECT * FROM users WHERE id = ?', [req.user.id])[0];
  if (!user || user.blocked) return res.status(403).json({ error: 'Cuenta bloqueada' });
  const { body } = req.body;
  if (!body || body.trim().length < 2) return res.status(400).json({ error: 'Comentario muy corto' });
  if (body.length > 1000) return res.status(400).json({ error: 'Comentario demasiado largo' });
  const topic = query('SELECT id FROM topics WHERE id = ?', [req.params.id])[0];
  if (!topic) return res.status(404).json({ error: 'Tema no encontrado' });

  const id = run('INSERT INTO comments (topic_id, author_id, body) VALUES (?, ?, ?)',
    [req.params.id, user.id, body.trim()]);
  run('UPDATE users SET posts_count = posts_count + 1 WHERE id = ?', [user.id]);
  // Bump de actividad: el tema sube en el ranking
  run(`UPDATE topics SET last_activity_at = datetime('now') WHERE id = ?`, [req.params.id]);
  saveDB();
  const cmt = query('SELECT c.*, u.username as author_name, u.role as author_role, u.stars as author_stars FROM comments c JOIN users u ON c.author_id=u.id WHERE c.id=?', [id])[0];
  res.status(201).json(cmt);
});

app.delete('/api/comments/:id', authMiddleware, (req, res) => {
  const user = query('SELECT * FROM users WHERE id = ?', [req.user.id])[0];
  const cmt = query('SELECT * FROM comments WHERE id = ?', [req.params.id])[0];
  if (!cmt) return res.status(404).json({ error: 'Comentario no encontrado' });
  if (cmt.author_id !== user.id && !['mod','master','admin'].includes(user.role))
    return res.status(403).json({ error: 'Sin permisos' });
  run('DELETE FROM comments WHERE id = ?', [req.params.id]);
  saveDB();
  res.json({ success: true });
});

app.post('/api/comments/:id/vote', authMiddleware, (req, res) => {
  const uid = req.user.id;
  const cid = req.params.id;
  const existing = query('SELECT id FROM votes WHERE user_id=? AND target_type=? AND target_id=?', [uid,'comment',cid]);
  if (existing.length) {
    run('DELETE FROM votes WHERE user_id=? AND target_type=? AND target_id=?', [uid,'comment',cid]);
    run('UPDATE comments SET votes = votes - 1 WHERE id = ?', [cid]);
    saveDB();
    return res.json({ voted: false });
  }
  run('INSERT INTO votes (user_id, target_type, target_id) VALUES (?,?,?)', [uid,'comment',cid]);
  run('UPDATE comments SET votes = votes + 1 WHERE id = ?', [cid]);
  saveDB();
  res.json({ voted: true });
});

// ═══════════════════════════════════════════════
// REPORTS / STAR SYSTEM
// ═══════════════════════════════════════════════
app.post('/api/reports', authMiddleware, (req, res) => {
  const { target_user_id, reason, detail } = req.body;
  if (req.user.id === target_user_id) return res.status(400).json({ error: 'No podés denunciarte a vos mismo' });
  
  const dup = query('SELECT id FROM reports WHERE reporter_id=? AND target_user_id=? AND reason=? AND status=?',
    [req.user.id, target_user_id, reason, 'pendiente']);
  if (dup.length) return res.status(409).json({ error: 'Ya tenés una denuncia pendiente contra este usuario por este motivo' });

  const target = query('SELECT * FROM users WHERE id = ?', [target_user_id])[0];
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

  // Denuncia queda PENDIENTE — el admin la valida antes de aplicar sanción
  run('INSERT INTO reports (reporter_id, target_user_id, reason, detail, status) VALUES (?,?,?,?,?)',
    [req.user.id, target_user_id, reason, detail || '', 'pendiente']);
  saveDB();

  res.json({ 
    success: true,
    message: `Denuncia enviada contra ${target.username}. El moderador la revisará.`
  });
});

// Aprobar denuncia (mod aplica la sanción)
app.post('/api/reports/:id/approve', authMiddleware, modMiddleware, (req, res) => {
  const report = query('SELECT * FROM reports WHERE id = ?', [req.params.id])[0];
  if (!report) return res.status(404).json({ error: 'Denuncia no encontrada' });
  if (report.status !== 'pendiente') return res.status(400).json({ error: 'Denuncia ya procesada' });

  const target = query('SELECT * FROM users WHERE id = ?', [report.target_user_id])[0];
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

  const newStars = Math.max(0, target.stars - 1);
  const blocked = newStars === 0 ? 1 : 0;
  run('UPDATE users SET stars = ?, blocked = ? WHERE id = ?', [newStars, blocked, target.id]);
  run(`UPDATE reports SET status='aprobada', resolved_by=?, resolved_at=datetime('now') WHERE id=?`,
    [req.user.id, report.id]);
  saveDB();

  res.json({ success: true, message: blocked ? `${target.username} bloqueado` : `★ quitada a ${target.username}` });
});

// Rechazar denuncia (sin sanción)
app.post('/api/reports/:id/reject', authMiddleware, modMiddleware, (req, res) => {
  const report = query('SELECT * FROM reports WHERE id = ?', [req.params.id])[0];
  if (!report) return res.status(404).json({ error: 'Denuncia no encontrada' });
  if (report.status !== 'pendiente') return res.status(400).json({ error: 'Denuncia ya procesada' });

  run(`UPDATE reports SET status='rechazada', resolved_by=?, resolved_at=datetime('now') WHERE id=?`,
    [req.user.id, report.id]);
  saveDB();
  res.json({ success: true, message: 'Denuncia rechazada' });
});

app.get('/api/reports', authMiddleware, modMiddleware, (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT r.*, reporter.username as reporter_name, target.username as target_name,
           target.stars as target_stars, target.blocked as target_blocked,
           resolver.username as resolver_name
    FROM reports r 
    JOIN users reporter ON r.reporter_id = reporter.id
    JOIN users target ON r.target_user_id = target.id
    LEFT JOIN users resolver ON r.resolved_by = resolver.id
    WHERE 1=1
  `;
  const params = [];
  if (status) { sql += ' AND r.status = ?'; params.push(status); }
  sql += ' ORDER BY r.created_at DESC';
  res.json(query(sql, params));
});

// ═══════════════════════════════════════════════
// ADMIN PANEL API
// ═══════════════════════════════════════════════

// Middleware: viewer+ (acceso a stats sin poder moderar)
function viewerMiddleware(req, res, next) {
  const user = query('SELECT * FROM users WHERE id = ?', [req.user.id])[0];
  if (!user || !['master','mod','admin','viewer'].includes(user.role))
    return res.status(403).json({ error: 'Sin permisos' });
  next();
}

app.get('/api/admin/stats', authMiddleware, viewerMiddleware, (req, res) => {
  const users = db.exec('SELECT COUNT(*) as c FROM users')[0].values[0][0];
  const topics = db.exec('SELECT COUNT(*) as c FROM topics')[0].values[0][0];
  const comments = db.exec('SELECT COUNT(*) as c FROM comments')[0].values[0][0];
  const blocked = db.exec('SELECT COUNT(*) as c FROM users WHERE blocked=1')[0].values[0][0];
  const reports = db.exec('SELECT COUNT(*) as c FROM reports')[0].values[0][0];
  const pending = db.exec("SELECT COUNT(*) as c FROM reports WHERE status='pendiente'")[0].values[0][0];
  const votes = db.exec('SELECT COUNT(*) as c FROM votes')[0].values[0][0];
  res.json({ users, topics, comments, blocked, reports, pending, votes });
});

// Dashboard completo — solo lectura, viewer+
app.get('/api/dashboard', authMiddleware, viewerMiddleware, (req, res) => {
  // Stats generales
  const users    = db.exec('SELECT COUNT(*) as c FROM users')[0].values[0][0];
  const topics   = db.exec('SELECT COUNT(*) as c FROM topics')[0].values[0][0];
  const comments = db.exec('SELECT COUNT(*) as c FROM comments')[0].values[0][0];
  const votes    = db.exec('SELECT COUNT(*) as c FROM votes')[0].values[0][0];
  const blocked  = db.exec('SELECT COUNT(*) as c FROM users WHERE blocked=1')[0].values[0][0];
  const pending  = db.exec("SELECT COUNT(*) as c FROM reports WHERE status='pendiente'")[0].values[0][0];

  // Nuevos usuarios últimos 7 días
  const newUsers7d = db.exec("SELECT COUNT(*) as c FROM users WHERE created_at >= datetime('now','-7 days')"
    )[0].values[0][0];

  // Top 5 temas por actividad
  const topTopics = query(`
    SELECT t.id, t.title, t.category, t.votes, t.last_activity_at,
           COUNT(DISTINCT c.id) as comment_count,
           u.username as author_name
    FROM topics t
    JOIN users u ON t.author_id = u.id
    LEFT JOIN comments c ON c.topic_id = t.id
    GROUP BY t.id
    ORDER BY (t.votes * 3 + COUNT(DISTINCT c.id) * 2) DESC
    LIMIT 5
  `);

  // Actividad por categoría
  const byCat = query(`
    SELECT t.category,
           COUNT(DISTINCT t.id) as topic_count,
           COUNT(DISTINCT c.id) as comment_count,
           SUM(t.votes) as total_votes
    FROM topics t
    LEFT JOIN comments c ON c.topic_id = t.id
    GROUP BY t.category
    ORDER BY comment_count DESC
  `);

  // Usuarios más activos (por posts)
  const topUsers = query(`
    SELECT username, role, posts_count, stars, blocked, created_at
    FROM users
    ORDER BY posts_count DESC
    LIMIT 8
  `);

  // Últimas 10 interacciones (comentarios recientes)
  const recentActivity = query(`
    SELECT c.created_at, c.body,
           u.username as author_name, u.role as author_role,
           t.title as topic_title, t.id as topic_id
    FROM comments c
    JOIN users u ON c.author_id = u.id
    JOIN topics t ON c.topic_id = t.id
    ORDER BY c.created_at DESC
    LIMIT 10
  `);

  // Temas creados por día (últimos 14 días)
  const topicsPerDay = query(`
    SELECT DATE(created_at) as day, COUNT(*) as count
    FROM topics
    WHERE created_at >= datetime('now', '-14 days')
    GROUP BY DATE(created_at)
    ORDER BY day ASC
  `);

  res.json({
    stats: { users, topics, comments, votes, blocked, pending, newUsers7d },
    topTopics,
    byCat,
    topUsers,
    recentActivity,
    topicsPerDay
  });
});

// Asignar rol viewer (solo master)
app.post('/api/users/set-viewer', authMiddleware, (req, res) => {
  const me = query('SELECT * FROM users WHERE id = ?', [req.user.id])[0];
  if (!me || me.role !== 'master') return res.status(403).json({ error: 'Solo el master puede asignar viewers' });
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email requerido' });
  const target = query('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()])[0];
  if (!target) return res.status(404).json({ error: 'No existe un usuario con ese email' });
  if (['master','mod'].includes(target.role)) return res.status(400).json({ error: 'El usuario ya tiene un rol superior' });
  run(`UPDATE users SET role = 'viewer' WHERE id = ?`, [target.id]);
  saveDB();
  res.json({ success: true, message: `${target.username} ahora tiene acceso al dashboard` });
});

// Votes info para el usuario actual
app.get('/api/my-votes', authMiddleware, (req, res) => {
  const votes = query('SELECT target_type, target_id FROM votes WHERE user_id = ?', [req.user.id]);
  res.json(votes);
});

// ═══════════════════════════════════════════════
// SERVE FRONTEND
// ═══════════════════════════════════════════════
app.get('/{*path}', (req, res) => {
  const indexPath = fs.existsSync(path.join(__dirname, 'public', 'index.html'))
    ? path.join(__dirname, 'public', 'index.html')
    : path.join(__dirname, 'index.html');
  res.sendFile(indexPath);
});

// ═══════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════╗
║  SARACATUNGA BBS v2.0 - by MV        ║
║  Server: http://localhost:${PORT}        ║
║  DB: ${DB_PATH}  ║
╚══════════════════════════════════════╝
    `);
  });
}).catch(console.error);
