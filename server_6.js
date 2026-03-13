/**
 * SARACATUNGA - Backend v4.0
 * sql.js (puro JS, sin compilación) + guardado al disco en cada write
 * Compatible 100% con Render sin dependencias nativas
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'saracatunga_secret_mv_2024';
const DB_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const DB_PATH = path.join(DB_DIR, 'saracatunga.db');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

const publicPath = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public') : __dirname;
app.use(express.static(publicPath));

// ── DB setup ──────────────────────────────────────────────────────────────────
let SQL, db;

async function initSQL() {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
    console.log(`✔ DB cargada desde disco: ${DB_PATH}`);
  } else {
    db = new SQL.Database();
    console.log('✔ DB nueva en memoria');
  }

  db.run(`PRAGMA foreign_keys = ON`);
  initSchema();
  saveToDisk(); // guardar inmediatamente si es nueva
}

function saveToDisk() {
  try {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) {
    console.error('Error guardando DB:', e.message);
  }
}

// Wrapper: ejecuta write y guarda al disco
function run(sql, params = []) {
  db.run(sql, params);
  saveToDisk();
}

// Ejecuta SELECT y devuelve array de objetos
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// Devuelve primer resultado o undefined
function get(sql, params = []) {
  return all(sql, params)[0];
}

// Run dentro de una transacción (para múltiples writes)
function runMany(ops) {
  db.run('BEGIN');
  try {
    for (const { sql, params } of ops) db.run(sql, params || []);
    db.run('COMMIT');
  } catch (e) {
    db.run('ROLLBACK');
    throw e;
  }
  saveToDisk();
}

// Insert y devuelve lastInsertRowid
function insert(sql, params = []) {
  db.run(sql, params);
  const id = db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0];
  saveToDisk();
  return id;
}

function initSchema() {
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
    )`);
  db.run(`
    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      category TEXT NOT NULL,
      author_id INTEGER NOT NULL,
      votes INTEGER DEFAULT 0,
      pinned INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      last_activity_at TEXT DEFAULT (datetime('now'))
    )`);
  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      votes INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
  db.run(`
    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      UNIQUE(user_id, target_type, target_id)
    )`);
  db.run(`
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
    )`);

  // Migraciones seguras
  try { db.run(`ALTER TABLE topics ADD COLUMN last_activity_at TEXT DEFAULT (datetime('now'))`); } catch(e) {}
  try { db.run(`ALTER TABLE reports ADD COLUMN status TEXT DEFAULT 'pendiente'`); } catch(e) {}
  try { db.run(`ALTER TABLE reports ADD COLUMN resolved_by INTEGER`); } catch(e) {}
  try { db.run(`ALTER TABLE reports ADD COLUMN resolved_at TEXT`); } catch(e) {}
  db.run(`UPDATE topics SET last_activity_at = created_at WHERE last_activity_at IS NULL`);

  // Usuarios base
  if (!get("SELECT id FROM users WHERE username='MV01'")) {
    db.run(`INSERT INTO users (username,email,password_hash,role,stars) VALUES (?,?,?,'master',3)`,
      ['MV01','matiasvaldivia81@gmail.com',bcrypt.hashSync('Vega678merlo',10)]);
    console.log('✔ MASTER MV01 creado');
  }
  if (!get("SELECT id FROM users WHERE username='SYSOP'")) {
    db.run(`INSERT INTO users (username,email,password_hash,role,stars) VALUES (?,?,?,'mod',3)`,
      ['SYSOP','sysop@saracatunga.bbs',bcrypt.hashSync('admin123',10)]);
  }
  if (get('SELECT COUNT(*) as c FROM topics').c === 0) {
    db.run(`INSERT INTO topics (title,body,category,author_id,pinned) VALUES (?,?,?,1,1)`, [
      'Bienvenidos a SARACATUNGA — Leé esto antes de arrancar',
      'Este es el foro donde los humanos debaten sin algoritmos, sin IA, sin filtros.\n\nOpiniones reales de personas reales.\n\nReglas:\n— Argumentá con datos, no con insultos\n— El desacuerdo es bienvenido, el acoso no\n— Cada usuario empieza con ★★★\n— A 0★ la cuenta queda bloqueada',
      'General'
    ]);
  }

  const count = get('SELECT COUNT(*) as c FROM topics').c;
  console.log(`✔ DB lista | Temas: ${count}`);
}

// ── Middleware ─────────────────────────────────────────────────────────────────
function auth(req,res,next){
  const h=req.headers.authorization;
  if(!h?.startsWith('Bearer ')) return res.status(401).json({error:'No autorizado'});
  try{req.user=jwt.verify(h.slice(7),JWT_SECRET);next();}
  catch(e){res.status(401).json({error:'Token inválido'});}
}
function isMod(req,res,next){
  const u=get('SELECT role FROM users WHERE id=?',[req.user.id]);
  if(!u||!['master','mod','admin'].includes(u.role)) return res.status(403).json({error:'Sin permisos'});
  next();
}
function isViewer(req,res,next){
  const u=get('SELECT role FROM users WHERE id=?',[req.user.id]);
  if(!u||!['master','mod','admin','viewer'].includes(u.role)) return res.status(403).json({error:'Sin permisos'});
  next();
}

// ── Rutas ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/register',(req,res)=>{
  const{username,email,password}=req.body;
  if(!username||!email||!password) return res.status(400).json({error:'Campos requeridos'});
  if(username.length<3||username.length>20) return res.status(400).json({error:'Usuario: 3-20 caracteres'});
  if(password.length<6) return res.status(400).json({error:'Contraseña: mínimo 6 caracteres'});
  if(!/^[a-zA-Z0-9_\-\.]+$/.test(username)) return res.status(400).json({error:'Usuario: solo letras, números, _ - .'});
  try{
    const id=insert(`INSERT INTO users (username,email,password_hash) VALUES (?,?,?)`,[username,email.toLowerCase(),bcrypt.hashSync(password,10)]);
    const u=get('SELECT * FROM users WHERE id=?',[id]);
    res.json({token:jwt.sign({id:u.id,username:u.username},JWT_SECRET,{expiresIn:'7d'}),user:{id:u.id,username:u.username,role:u.role,stars:u.stars,blocked:u.blocked}});
  }catch(e){
    if(e.message.includes('UNIQUE')) return res.status(400).json({error:'Usuario o email ya registrado'});
    res.status(500).json({error:'Error al registrar'});
  }
});

app.post('/api/auth/login',(req,res)=>{
  const{username,password}=req.body;
  if(!username||!password) return res.status(400).json({error:'Campos requeridos'});
  const u=get('SELECT * FROM users WHERE username=?',[username]);
  if(!u||!bcrypt.compareSync(password,u.password_hash)) return res.status(401).json({error:'Usuario o contraseña incorrectos'});
  res.json({token:jwt.sign({id:u.id,username:u.username},JWT_SECRET,{expiresIn:'7d'}),user:{id:u.id,username:u.username,role:u.role,stars:u.stars,blocked:u.blocked}});
});

app.get('/api/auth/me',auth,(req,res)=>{
  const u=get('SELECT id,username,role,stars,blocked,created_at,posts_count FROM users WHERE id=?',[req.user.id]);
  if(!u) return res.status(404).json({error:'Usuario no encontrado'});
  res.json(u);
});

app.get('/api/topics',(req,res)=>{
  try{
    const{category}=req.query;
    let sql=`SELECT t.*,u.username as author_name,u.role as author_role,u.stars as author_stars,u.blocked as author_blocked,
      COUNT(DISTINCT c.id) as comment_count,
      (t.votes*3.0+COUNT(DISTINCT c.id)*2.0+20.0/(MAX(0.5,CAST((julianday('now')-julianday(COALESCE(t.last_activity_at,t.created_at)))*24 AS REAL))+1)) as activity_score
      FROM topics t JOIN users u ON t.author_id=u.id LEFT JOIN comments c ON c.topic_id=t.id WHERE 1=1`;
    const params=[];
    if(category&&category!=='todas'){sql+=' AND t.category=?';params.push(category);}
    sql+=' GROUP BY t.id ORDER BY t.pinned DESC,activity_score DESC';
    res.json(all(sql,params));
  }catch(e){console.error('GET /api/topics:',e.message);res.status(500).json({error:e.message});}
});

app.post('/api/topics',auth,(req,res)=>{
  const u=get('SELECT * FROM users WHERE id=?',[req.user.id]);
  if(!u) return res.status(404).json({error:'Usuario no encontrado'});
  if(u.blocked) return res.status(403).json({error:'Cuenta bloqueada'});
  const{title,body,category}=req.body;
  if(!title||!body||!category) return res.status(400).json({error:'Campos requeridos'});
  if(title.length<15) return res.status(400).json({error:'Título muy corto (mín. 15 caracteres)'});
  if(body.length<30) return res.status(400).json({error:'Cuerpo muy corto (mín. 30 caracteres)'});
  const validCats=['General','Politica','Tecnologia','Cultura','Ciencia','Deporte','Humor','Off-Topic','Varios'];
  if(!validCats.includes(category)) return res.status(400).json({error:'Categoría inválida'});
  const id=insert(`INSERT INTO topics (title,body,category,author_id,last_activity_at) VALUES (?,?,?,?,datetime('now'))`,[title,body,category,u.id]);
  run(`UPDATE users SET posts_count=posts_count+1 WHERE id=?`,[u.id]);
  res.json(get('SELECT * FROM topics WHERE id=?',[id]));
});

app.get('/api/topics/:id',(req,res)=>{
  const t=get(`SELECT t.*,u.username as author_name,u.role as author_role,u.stars as author_stars FROM topics t JOIN users u ON t.author_id=u.id WHERE t.id=?`,[req.params.id]);
  if(!t) return res.status(404).json({error:'Tema no encontrado'});
  res.json(t);
});

app.delete('/api/topics/:id',auth,(req,res)=>{
  const u=get('SELECT * FROM users WHERE id=?',[req.user.id]);
  const t=get('SELECT * FROM topics WHERE id=?',[req.params.id]);
  if(!t) return res.status(404).json({error:'Tema no encontrado'});
  if(t.author_id!==u.id&&!['master','mod'].includes(u.role)) return res.status(403).json({error:'Sin permisos'});
  runMany([
    {sql:'DELETE FROM comments WHERE topic_id=?',params:[t.id]},
    {sql:'DELETE FROM votes WHERE target_type=? AND target_id=?',params:['topic',t.id]},
    {sql:'DELETE FROM topics WHERE id=?',params:[t.id]},
  ]);
  res.json({success:true});
});

app.post('/api/topics/:id/pin',auth,isMod,(req,res)=>{
  const t=get('SELECT * FROM topics WHERE id=?',[req.params.id]);
  if(!t) return res.status(404).json({error:'Tema no encontrado'});
  run('UPDATE topics SET pinned=? WHERE id=?',[t.pinned?0:1,t.id]);
  res.json({success:true,pinned:!t.pinned});
});

app.post('/api/topics/:id/vote',auth,(req,res)=>{
  const u=get('SELECT * FROM users WHERE id=?',[req.user.id]);
  if(u.blocked) return res.status(403).json({error:'Cuenta bloqueada'});
  const t=get('SELECT * FROM topics WHERE id=?',[req.params.id]);
  if(!t) return res.status(404).json({error:'Tema no encontrado'});
  const existing=get('SELECT id FROM votes WHERE user_id=? AND target_type=? AND target_id=?',[u.id,'topic',t.id]);
  if(existing) return res.status(400).json({error:'Ya votaste este tema'});
  runMany([
    {sql:'INSERT INTO votes (user_id,target_type,target_id) VALUES (?,?,?)',params:[u.id,'topic',t.id]},
    {sql:`UPDATE topics SET votes=votes+1,last_activity_at=datetime('now') WHERE id=?`,params:[t.id]},
  ]);
  res.json({success:true,votes:t.votes+1});
});

app.get('/api/topics/:id/comments',(req,res)=>{
  res.json(all(`SELECT c.*,u.username as author_name,u.role as author_role,u.stars as author_stars,u.blocked as author_blocked FROM comments c JOIN users u ON c.author_id=u.id WHERE c.topic_id=? ORDER BY c.created_at ASC`,[req.params.id]));
});

app.post('/api/topics/:id/comments',auth,(req,res)=>{
  const u=get('SELECT * FROM users WHERE id=?',[req.user.id]);
  if(u.blocked) return res.status(403).json({error:'Cuenta bloqueada'});
  const{body}=req.body;
  if(!body||body.trim().length<2) return res.status(400).json({error:'Comentario muy corto'});
  const t=get('SELECT * FROM topics WHERE id=?',[req.params.id]);
  if(!t) return res.status(404).json({error:'Tema no encontrado'});
  const id=insert('INSERT INTO comments (topic_id,author_id,body) VALUES (?,?,?)',[t.id,u.id,body.trim()]);
  runMany([
    {sql:`UPDATE topics SET last_activity_at=datetime('now') WHERE id=?`,params:[t.id]},
    {sql:'UPDATE users SET posts_count=posts_count+1 WHERE id=?',params:[u.id]},
  ]);
  res.json(get(`SELECT c.*,u.username as author_name,u.role as author_role,u.stars as author_stars FROM comments c JOIN users u ON c.author_id=u.id WHERE c.id=?`,[id]));
});

app.delete('/api/comments/:id',auth,(req,res)=>{
  const u=get('SELECT * FROM users WHERE id=?',[req.user.id]);
  const c=get('SELECT * FROM comments WHERE id=?',[req.params.id]);
  if(!c) return res.status(404).json({error:'Comentario no encontrado'});
  if(c.author_id!==u.id&&!['master','mod'].includes(u.role)) return res.status(403).json({error:'Sin permisos'});
  run('DELETE FROM comments WHERE id=?',[c.id]);
  res.json({success:true});
});

app.post('/api/comments/:id/vote',auth,(req,res)=>{
  const u=get('SELECT * FROM users WHERE id=?',[req.user.id]);
  if(u.blocked) return res.status(403).json({error:'Cuenta bloqueada'});
  const c=get('SELECT * FROM comments WHERE id=?',[req.params.id]);
  if(!c) return res.status(404).json({error:'Comentario no encontrado'});
  const existing=get('SELECT id FROM votes WHERE user_id=? AND target_type=? AND target_id=?',[u.id,'comment',c.id]);
  if(existing) return res.status(400).json({error:'Ya votaste este comentario'});
  runMany([
    {sql:'INSERT INTO votes (user_id,target_type,target_id) VALUES (?,?,?)',params:[u.id,'comment',c.id]},
    {sql:'UPDATE comments SET votes=votes+1 WHERE id=?',params:[c.id]},
  ]);
  res.json({success:true,votes:c.votes+1});
});

app.get('/api/users',auth,isMod,(req,res)=>{
  res.json(all('SELECT id,username,email,role,stars,blocked,created_at,posts_count FROM users ORDER BY created_at DESC'));
});

app.post('/api/users/:id/promote',auth,isMod,(req,res)=>{
  const me=get('SELECT role FROM users WHERE id=?',[req.user.id]);
  if(me.role!=='master') return res.status(403).json({error:'Solo el master puede promover'});
  const{role}=req.body;
  if(!['mod','user'].includes(role)) return res.status(400).json({error:'Rol inválido'});
  run('UPDATE users SET role=? WHERE id=?',[role,req.params.id]);
  res.json({success:true});
});

app.post('/api/users/:id/restore-star',auth,isMod,(req,res)=>{
  const t=get('SELECT * FROM users WHERE id=?',[req.params.id]);
  if(!t) return res.status(404).json({error:'Usuario no encontrado'});
  run('UPDATE users SET stars=?,blocked=0 WHERE id=?',[Math.min(3,t.stars+1),t.id]);
  res.json({success:true,message:`★ restaurada a ${t.username}`});
});

app.post('/api/users/:id/block',auth,isMod,(req,res)=>{
  run('UPDATE users SET blocked=1,stars=0 WHERE id=?',[req.params.id]);
  res.json({success:true});
});

app.post('/api/reports',auth,(req,res)=>{
  const u=get('SELECT * FROM users WHERE id=?',[req.user.id]);
  if(u.blocked) return res.status(403).json({error:'Cuenta bloqueada'});
  const{target_user_id,reason,detail}=req.body;
  if(!target_user_id||!reason) return res.status(400).json({error:'Campos requeridos'});
  insert('INSERT INTO reports (reporter_id,target_user_id,reason,detail) VALUES (?,?,?,?)',[u.id,target_user_id,reason,detail||'']);
  res.json({success:true,message:'Denuncia enviada.'});
});

app.post('/api/reports/:id/approve',auth,isMod,(req,res)=>{
  const r=get('SELECT * FROM reports WHERE id=?',[req.params.id]);
  if(!r) return res.status(404).json({error:'No encontrada'});
  if(r.status!=='pendiente') return res.status(400).json({error:'Ya procesada'});
  const t=get('SELECT * FROM users WHERE id=?',[r.target_user_id]);
  const ns=Math.max(0,t.stars-1);
  runMany([
    {sql:'UPDATE users SET stars=?,blocked=? WHERE id=?',params:[ns,ns===0?1:0,t.id]},
    {sql:`UPDATE reports SET status='aprobada',resolved_by=?,resolved_at=datetime('now') WHERE id=?`,params:[req.user.id,r.id]},
  ]);
  res.json({success:true,message:ns===0?`${t.username} bloqueado`:`★ quitada a ${t.username}`});
});

app.post('/api/reports/:id/reject',auth,isMod,(req,res)=>{
  const r=get('SELECT * FROM reports WHERE id=?',[req.params.id]);
  if(!r) return res.status(404).json({error:'No encontrada'});
  if(r.status!=='pendiente') return res.status(400).json({error:'Ya procesada'});
  run(`UPDATE reports SET status='rechazada',resolved_by=?,resolved_at=datetime('now') WHERE id=?`,[req.user.id,r.id]);
  res.json({success:true});
});

app.get('/api/reports',auth,isMod,(req,res)=>{
  const{status}=req.query;
  let sql=`SELECT r.*,reporter.username as reporter_name,target.username as target_name,target.stars as target_stars,target.blocked as target_blocked,resolver.username as resolver_name
    FROM reports r JOIN users reporter ON r.reporter_id=reporter.id JOIN users target ON r.target_user_id=target.id LEFT JOIN users resolver ON r.resolved_by=resolver.id WHERE 1=1`;
  const p=[];
  if(status){sql+=' AND r.status=?';p.push(status);}
  sql+=' ORDER BY r.created_at DESC';
  res.json(all(sql,p));
});

app.get('/api/admin/stats',auth,isViewer,(req,res)=>{
  res.json({
    users:get('SELECT COUNT(*) as c FROM users').c,
    topics:get('SELECT COUNT(*) as c FROM topics').c,
    comments:get('SELECT COUNT(*) as c FROM comments').c,
    blocked:get('SELECT COUNT(*) as c FROM users WHERE blocked=1').c,
    reports:get('SELECT COUNT(*) as c FROM reports').c,
    pending:get("SELECT COUNT(*) as c FROM reports WHERE status='pendiente'").c,
    votes:get('SELECT COUNT(*) as c FROM votes').c,
  });
});

app.get('/api/dashboard',auth,isViewer,(req,res)=>{
  res.json({
    stats:{
      users:get('SELECT COUNT(*) as c FROM users').c,
      topics:get('SELECT COUNT(*) as c FROM topics').c,
      comments:get('SELECT COUNT(*) as c FROM comments').c,
      votes:get('SELECT COUNT(*) as c FROM votes').c,
      blocked:get('SELECT COUNT(*) as c FROM users WHERE blocked=1').c,
      pending:get("SELECT COUNT(*) as c FROM reports WHERE status='pendiente'").c,
      newUsers7d:get("SELECT COUNT(*) as c FROM users WHERE created_at>=datetime('now','-7 days')").c,
    },
    topTopics:all(`SELECT t.id,t.title,t.category,t.votes,t.last_activity_at,COUNT(DISTINCT c.id) as comment_count,u.username as author_name FROM topics t JOIN users u ON t.author_id=u.id LEFT JOIN comments c ON c.topic_id=t.id GROUP BY t.id ORDER BY (t.votes*3+COUNT(DISTINCT c.id)*2) DESC LIMIT 5`),
    byCat:all(`SELECT t.category,COUNT(DISTINCT t.id) as topic_count,COUNT(DISTINCT c.id) as comment_count,SUM(t.votes) as total_votes FROM topics t LEFT JOIN comments c ON c.topic_id=t.id GROUP BY t.category ORDER BY comment_count DESC`),
    topUsers:all('SELECT username,role,posts_count,stars,blocked,created_at FROM users ORDER BY posts_count DESC LIMIT 8'),
    recentActivity:all(`SELECT c.created_at,c.body,u.username as author_name,u.role as author_role,t.title as topic_title,t.id as topic_id FROM comments c JOIN users u ON c.author_id=u.id JOIN topics t ON c.topic_id=t.id ORDER BY c.created_at DESC LIMIT 10`),
    topicsPerDay:[],
  });
});

app.post('/api/users/set-viewer',auth,(req,res)=>{
  const me=get('SELECT role FROM users WHERE id=?',[req.user.id]);
  if(!me||me.role!=='master') return res.status(403).json({error:'Solo el master puede asignar viewers'});
  const{email}=req.body;
  if(!email) return res.status(400).json({error:'Email requerido'});
  const t=get('SELECT * FROM users WHERE email=?',[email.toLowerCase().trim()]);
  if(!t) return res.status(404).json({error:'No existe un usuario con ese email'});
  if(['master','mod'].includes(t.role)) return res.status(400).json({error:'Ya tiene rol superior'});
  run(`UPDATE users SET role='viewer' WHERE id=?`,[t.id]);
  res.json({success:true,message:`${t.username} ahora tiene acceso al dashboard`});
});

app.get('/api/my-votes',auth,(req,res)=>{
  res.json(all('SELECT target_type,target_id FROM votes WHERE user_id=?',[req.user.id]));
});

app.get('/{*path}',(req,res)=>{
  const p=fs.existsSync(path.join(__dirname,'public','index.html'))
    ?path.join(__dirname,'public','index.html'):path.join(__dirname,'index.html');
  res.sendFile(p);
});

// ── Arrancar ───────────────────────────────────────────────────────────────────
initSQL().then(()=>{
  app.listen(PORT,()=>{
    console.log(`SARACATUNGA v4.0 | Puerto ${PORT} | DB: ${DB_PATH}`);
  });
}).catch(e=>{
  console.error('Error iniciando DB:',e);
  process.exit(1);
});
