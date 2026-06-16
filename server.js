const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const ExcelJS = require('exceljs');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const SQLiteStore = require('connect-sqlite3')(session);
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType } = require('docx');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Seguridad
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            defaultSrc: ["'self'", "'unsafe-eval'", "'unsafe-inline'", "http:", "https:", "data:", "blob:"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "http:", "https:", "data:", "blob:", "https://unpkg.com", "https://cdn.quasar.dev"],
            styleSrc: ["'self'", "'unsafe-inline'", "http:", "https:", "https://cdn.quasar.dev", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "http:", "https:", "data:", "https://fonts.gstatic.com", "https://cdn.quasar.dev"],
            connectSrc: ["'self'", "http:", "https:", "data:", "blob:"],
            imgSrc: ["'self'", "http:", "https:", "data:", "blob:"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'", "http:", "https:", "data:"],
            frameSrc: ["'self'", "http:", "https:"]
        }
    }
}));

app.use(compression());
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Sesiones
const dbPath = path.join(dataDir, 'tasks.db');
app.use(session({
    store: new SQLiteStore({ db: 'sessions.db', dir: dataDir }),
    secret: process.env.SESSION_SECRET || 'quickplan-dev-secret-change-in-prod',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Demasiadas solicitudes, intenta en 15 minutos' }
});

const refreshLimiter = rateLimit({
    windowMs: 2000,
    max: 10,
    message: { error: 'Refresh muy frecuente, espera un momento' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health' || req.path === '/api/health'
});

app.use('/api/', limiter);
app.use('/', refreshLimiter);

// Base de datos
console.log('📁 Base de datos en:', dbPath);

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('❌ Error conectando a la base de datos:', err);
    } else {
        console.log('✅ Conectado a la base de datos SQLite');
        db.run('PRAGMA journal_mode = WAL;');
        db.run('PRAGMA synchronous = NORMAL;');
        db.run('PRAGMA cache_size = 1000;');
        db.run('PRAGMA temp_store = memory;');
        db.run('PRAGMA busy_timeout = 5000;');
        db.run('PRAGMA foreign_keys = ON;');
        console.log('⚡ SQLite optimizado');
    }
});

// ── Tablas ──────────────────────────────────────────────────────────────────

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            google_id TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            username TEXT UNIQUE NOT NULL,
            avatar TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS plan_shares (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            shared_with_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            permission TEXT NOT NULL DEFAULT 'read',
            expires_at DATETIME DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(owner_id, shared_with_id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tarea TEXT NOT NULL,
            horas REAL DEFAULT 0,
            observaciones TEXT DEFAULT '',
            recurso TEXT DEFAULT '',
            sort_order INTEGER DEFAULT 0,
            user_id INTEGER REFERENCES users(id),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, () => {
        // Migraciones inline
        const cols = ['sort_order', 'parent_id', 'is_subtask', 'status', 'user_id'];
        cols.forEach(col => {
            let def = 'INTEGER DEFAULT 0';
            if (col === 'parent_id') def = 'INTEGER DEFAULT NULL';
            if (col === 'status') def = "TEXT DEFAULT 'pending'";
            if (col === 'user_id') def = 'INTEGER REFERENCES users(id)';
            db.run(`ALTER TABLE tasks ADD COLUMN ${col} ${def}`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error(`❌ Error agregando columna ${col}:`, err);
                }
            });
        });
        console.log('✅ Tabla tasks lista');
    });

    db.run(`
        CREATE TABLE IF NOT EXISTS user_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            key TEXT NOT NULL,
            value_enc TEXT NOT NULL,
            iv TEXT NOT NULL,
            auth_tag TEXT NOT NULL,
            UNIQUE(user_id, key)
        )
    `, () => { console.log('✅ Tabla user_settings lista'); });

    db.run(`
        CREATE TABLE IF NOT EXISTS requirements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            ai_provider TEXT DEFAULT 'claude',
            context_summary TEXT DEFAULT '',
            messages TEXT DEFAULT '[]',
            status TEXT DEFAULT 'draft',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, () => {
        console.log('✅ Tabla requirements lista');
        db.run(`ALTER TABLE requirements ADD COLUMN doc_content TEXT DEFAULT NULL`, (err) => {
            if (err && !err.message.includes('duplicate column name')) console.error('Migration doc_content:', err);
        });
    });
});

// ── Passport Google OAuth ────────────────────────────────────────────────────

function findOrCreateUser(googleId, email, name, avatar, done) {
    db.get('SELECT * FROM users WHERE google_id = ?', [googleId], (err, user) => {
        if (err) return done(err);
        if (user) {
            db.run('UPDATE users SET name = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [name, avatar, user.id]);
            return done(null, user);
        }

        // Generar username único desde el email prefix
        let baseUsername = email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '');
        if (!baseUsername) baseUsername = 'user';

        function tryInsert(candidate, attempt) {
            const username = attempt === 0 ? candidate : `${candidate}${attempt}`;
            db.run(
                'INSERT INTO users (google_id, email, name, username, avatar) VALUES (?, ?, ?, ?, ?)',
                [googleId, email, name, username, avatar],
                function(err) {
                    if (err && err.message.includes('UNIQUE constraint')) {
                        return tryInsert(candidate, attempt + 1);
                    }
                    if (err) return done(err);
                    db.get('SELECT * FROM users WHERE id = ?', [this.lastID], done);
                }
            );
        }
        tryInsert(baseUsername, 0);
    });
}

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback'
    }, (accessToken, refreshToken, profile, done) => {
        const email = profile.emails?.[0]?.value || '';
        const name = profile.displayName || email;
        const avatar = profile.photos?.[0]?.value || '';
        findOrCreateUser(profile.id, email, name, avatar, done);
    }));
    console.log('🔑 Google OAuth activado');
} else {
    console.warn('⚠️  GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET no configurados — OAuth deshabilitado');
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
    db.get('SELECT * FROM users WHERE id = ?', [id], (err, user) => done(err, user || null));
});

// ── Middleware de autenticación ──────────────────────────────────────────────

function requireAuth(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    next();
}

// Resuelve qué plan se está viendo y si hay permiso de escritura.
// Adjunta req.viewUserId (int) y req.isReadOnly (bool) al request.
function resolveViewUser(req, res, next) {
    const queryUserId = req.query.userId ? parseInt(req.query.userId) : null;

    if (!queryUserId || queryUserId === req.user.id) {
        req.viewUserId = req.user.id;
        req.sharePermission = 'own';
        req.isReadOnly = false;
        return next();
    }

    const now = new Date().toISOString();
    db.get(
        `SELECT * FROM plan_shares
         WHERE owner_id = ? AND shared_with_id = ?
           AND (expires_at IS NULL OR expires_at > ?)`,
        [queryUserId, req.user.id, now],
        (err, share) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!share) return res.status(403).json({ error: 'No tienes acceso a este plan o el acceso ha vencido' });
            req.viewUserId = queryUserId;
            req.sharePermission = share.permission;
            req.isReadOnly = share.permission === 'read';
            next();
        }
    );
}

// ── Rutas de autenticación ───────────────────────────────────────────────────

app.get('/auth/google', (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID) {
        return res.status(503).send('OAuth no configurado. Configura GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET.');
    }
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/?error=auth_failed' }),
    (req, res) => res.redirect('/')
);

app.get('/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) console.error('Error en logout:', err);
        req.session.destroy(() => res.redirect('/'));
    });
});

app.get('/api/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    res.json({
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        username: req.user.username,
        avatar: req.user.avatar
    });
});

// ── Health checks ────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        service: 'QuickPlan',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        }
    });
});

app.get('/api/health', (req, res) => {
    db.get('SELECT 1 as test', (err) => {
        if (err) return res.status(503).json({ status: 'ERROR', database: 'FAILED', error: err.message });
        res.json({ status: 'OK', database: 'OK', uptime: process.uptime(), service: 'QuickPlan API', version: '2.0.0' });
    });
});

// ── Búsqueda de usuarios ─────────────────────────────────────────────────────

app.get('/api/users/search', requireAuth, (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);

    const like = `%${q}%`;
    db.all(
        `SELECT id, name, username, avatar FROM users
         WHERE id != ? AND (username LIKE ? OR name LIKE ?)
         LIMIT 10`,
        [req.user.id, like, like],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

// ── Compartición de planes ───────────────────────────────────────────────────

app.get('/api/shares', requireAuth, (req, res) => {
    db.all(
        `SELECT ps.id, ps.owner_id, ps.shared_with_id, ps.permission, ps.expires_at, ps.created_at,
                sw.name AS shared_with_name, sw.username AS shared_with_username, sw.avatar AS shared_with_avatar,
                ow.name AS owner_name, ow.username AS owner_username, ow.avatar AS owner_avatar
         FROM plan_shares ps
         JOIN users sw ON sw.id = ps.shared_with_id
         JOIN users ow ON ow.id = ps.owner_id
         WHERE ps.owner_id = ? OR ps.shared_with_id = ?
         ORDER BY ps.created_at DESC`,
        [req.user.id, req.user.id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

app.post('/api/shares', requireAuth, (req, res) => {
    const { username, permission, expiresAt } = req.body;

    if (!username) return res.status(400).json({ error: 'Nombre de usuario requerido' });
    if (!['read', 'edit'].includes(permission)) return res.status(400).json({ error: 'Permiso inválido (read | edit)' });

    db.get('SELECT id, name, username FROM users WHERE username = ?', [username], (err, target) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!target) {
            return res.status(404).json({
                error: `El usuario "${username}" no está registrado en QuickPlan. Solo puedes compartir con usuarios registrados.`
            });
        }
        if (target.id === req.user.id) return res.status(400).json({ error: 'No puedes compartir contigo mismo' });

        const expiresValue = expiresAt || null;
        db.run(
            `INSERT INTO plan_shares (owner_id, shared_with_id, permission, expires_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(owner_id, shared_with_id) DO UPDATE SET permission = excluded.permission, expires_at = excluded.expires_at`,
            [req.user.id, target.id, permission, expiresValue],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: `Plan compartido con ${target.name}`, user: target });
            }
        );
    });
});

app.put('/api/shares/:id', requireAuth, (req, res) => {
    const { permission, expiresAt } = req.body;

    if (permission && !['read', 'edit'].includes(permission)) {
        return res.status(400).json({ error: 'Permiso inválido (read | edit)' });
    }

    db.get('SELECT * FROM plan_shares WHERE id = ?', [req.params.id], (err, share) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!share) return res.status(404).json({ error: 'Compartición no encontrada' });
        if (share.owner_id !== req.user.id) return res.status(403).json({ error: 'Solo el dueño puede modificar la compartición' });

        const newPermission = permission || share.permission;
        const newExpiry = expiresAt !== undefined ? (expiresAt || null) : share.expires_at;

        db.run(
            'UPDATE plan_shares SET permission = ?, expires_at = ? WHERE id = ?',
            [newPermission, newExpiry, share.id],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Compartición actualizada' });
            }
        );
    });
});

app.delete('/api/shares/:id', requireAuth, (req, res) => {
    db.run(
        'DELETE FROM plan_shares WHERE id = ? AND (owner_id = ? OR shared_with_id = ?)',
        [req.params.id, req.user.id, req.user.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Compartición no encontrada o sin permiso' });
            res.json({ message: 'Compartición eliminada' });
        }
    );
});

// ── Helper interno: obtener tareas jerárquicas ───────────────────────────────

function fetchTasksHierarchy(userId, res) {
    db.all(
        `SELECT * FROM tasks
         WHERE user_id = ?
         ORDER BY CASE WHEN parent_id IS NULL THEN sort_order ELSE parent_id END,
                  parent_id IS NULL DESC, sort_order ASC, created_at DESC`,
        [userId],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });

            const taskMap = {};
            const hierarchicalTasks = [];
            rows.forEach(t => { t.subtasks = []; taskMap[t.id] = t; });
            rows.forEach(t => {
                if (t.parent_id && taskMap[t.parent_id]) {
                    taskMap[t.parent_id].subtasks.push(t);
                } else if (!t.parent_id) {
                    hierarchicalTasks.push(t);
                }
            });

            res.json(hierarchicalTasks);
        }
    );
}

// ── API de Tareas ────────────────────────────────────────────────────────────

app.get('/api/tasks', requireAuth, resolveViewUser, (req, res) => {
    fetchTasksHierarchy(req.viewUserId, res);
});

app.post('/api/tasks', requireAuth, resolveViewUser, (req, res) => {
    if (req.isReadOnly) return res.status(403).json({ error: 'Solo tienes permiso de lectura en este plan' });

    const { tarea, horas, observaciones, recurso } = req.body;
    if (!tarea || !recurso) return res.status(400).json({ error: 'Tarea y recurso son requeridos' });

    db.run(
        `INSERT INTO tasks (tarea, horas, observaciones, recurso, user_id, sort_order)
         VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks WHERE user_id = ?))`,
        [tarea, parseFloat(horas) || 0, observaciones || '', recurso, req.viewUserId, req.viewUserId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            invalidateStatsCache(req.viewUserId);
            res.json({ id: this.lastID, message: 'Tarea creada exitosamente' });
        }
    );
});

app.post('/api/tasks/:parentId/subtasks', requireAuth, resolveViewUser, (req, res) => {
    if (req.isReadOnly) return res.status(403).json({ error: 'Solo tienes permiso de lectura en este plan' });

    const { tarea, horas, observaciones } = req.body;
    const parentId = req.params.parentId;
    const newHours = parseFloat(horas) || 0;

    if (!tarea) return res.status(400).json({ error: 'La subtarea requiere un título' });

    db.get('SELECT horas FROM tasks WHERE id = ? AND parent_id IS NULL AND user_id = ?', [parentId, req.viewUserId], (err, parentTask) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!parentTask) return res.status(404).json({ error: 'Tarea padre no encontrada' });

        const parentHours = parentTask.horas || 0;
        db.get('SELECT COALESCE(SUM(horas), 0) as total FROM tasks WHERE parent_id = ?', [parentId], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });

            const currentTotal = result.total || 0;
            if (currentTotal + newHours > parentHours) {
                const available = parentHours - currentTotal;
                return res.status(400).json({
                    error: `Las horas exceden el total de la tarea padre. Disponible: ${available.toFixed(2)}h de ${parentHours}h total`,
                    available, parentHours, currentSubtasks: currentTotal, requested: newHours
                });
            }

            db.run(
                `INSERT INTO tasks (tarea, horas, observaciones, recurso, parent_id, is_subtask, user_id, sort_order)
                 VALUES (?, ?, ?, '', ?, 1, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks WHERE parent_id = ?))`,
                [tarea, newHours, observaciones || '', parentId, req.viewUserId, parentId],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    invalidateStatsCache(req.viewUserId);
                    res.json({
                        id: this.lastID,
                        message: 'Subtarea creada exitosamente',
                        hoursUsed: currentTotal + newHours,
                        hoursTotal: parentHours,
                        hoursRemaining: parentHours - currentTotal - newHours
                    });
                }
            );
        });
    });
});

app.put('/api/tasks/reorder', requireAuth, resolveViewUser, (req, res) => {
    if (req.isReadOnly) return res.status(403).json({ error: 'Solo tienes permiso de lectura en este plan' });

    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'Se requiere un array de IDs' });

    const updates = order.map((taskId, index) =>
        new Promise((resolve, reject) => {
            db.run('UPDATE tasks SET sort_order = ? WHERE id = ? AND user_id = ?', [index, taskId, req.viewUserId],
                (err) => err ? reject(err) : resolve());
        })
    );

    Promise.all(updates)
        .then(() => { invalidateStatsCache(req.viewUserId); res.json({ message: 'Orden actualizado' }); })
        .catch(err => res.status(500).json({ error: err.message }));
});

app.put('/api/tasks/:id', requireAuth, resolveViewUser, (req, res) => {
    if (req.isReadOnly) return res.status(403).json({ error: 'Solo tienes permiso de lectura en este plan' });

    const { tarea, horas, observaciones, recurso, status } = req.body;
    const { id } = req.params;
    const newHours = parseFloat(horas) || 0;

    db.get('SELECT COALESCE(SUM(horas), 0) as subtask_total FROM tasks WHERE parent_id = ?', [id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        const subtaskTotal = result.subtask_total || 0;
        if (subtaskTotal > 0 && newHours < subtaskTotal) {
            return res.status(400).json({
                error: `Las horas no pueden ser menores que la suma de subtareas (${subtaskTotal.toFixed(2)}h)`
            });
        }

        db.run(
            `UPDATE tasks SET tarea = ?, horas = ?, observaciones = ?, recurso = ?, status = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND user_id = ?`,
            [tarea, newHours, observaciones || '', recurso || '', status || 'pending', id, req.viewUserId],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                if (this.changes === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
                invalidateStatsCache(req.viewUserId);
                res.json({ message: 'Tarea actualizada exitosamente' });
            }
        );
    });
});

app.delete('/api/tasks', requireAuth, resolveViewUser, (req, res) => {
    // Solo el dueño puede limpiar todo
    if (req.viewUserId !== req.user.id) return res.status(403).json({ error: 'Solo el dueño puede limpiar todas las tareas' });

    db.run('DELETE FROM tasks WHERE user_id = ?', [req.user.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        invalidateStatsCache(req.user.id);
        res.json({ message: `${this.changes} tareas eliminadas exitosamente` });
    });
});

app.delete('/api/tasks/:id', requireAuth, resolveViewUser, (req, res) => {
    if (req.isReadOnly) return res.status(403).json({ error: 'Solo tienes permiso de lectura en este plan' });

    const { id } = req.params;
    db.run('DELETE FROM tasks WHERE parent_id = ? AND user_id = ?', [id, req.viewUserId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.run('DELETE FROM tasks WHERE id = ? AND user_id = ?', [id, req.viewUserId], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
            invalidateStatsCache(req.viewUserId);
            res.json({ message: 'Tarea eliminada exitosamente' });
        });
    });
});

app.get('/api/tasks/:id/validate', requireAuth, resolveViewUser, (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM tasks WHERE id = ? AND is_subtask = 0 AND user_id = ?', [id, req.viewUserId], (err, parentTask) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!parentTask) return res.status(404).json({ error: 'Tarea no encontrada' });

        db.get('SELECT SUM(horas) as total_subtasks FROM tasks WHERE parent_id = ?', [id], (err, result) => {
            if (err) return res.status(500).json({ error: err.message });

            const totalSubtasks = result.total_subtasks || 0;
            const parentHours = parentTask.horas || 0;
            const isValid = Math.abs(totalSubtasks - parentHours) < 0.01;

            res.json({
                parentHours, totalSubtasks,
                difference: totalSubtasks - parentHours,
                isValid,
                message: isValid ? 'Las horas coinciden' : `Diferencia de ${(totalSubtasks - parentHours).toFixed(2)} horas`
            });
        });
    });
});

app.post('/api/tasks/reorder', requireAuth, resolveViewUser, (req, res) => {
    if (req.isReadOnly) return res.status(403).json({ error: 'Solo tienes permiso de lectura en este plan' });

    const { taskId, targetTaskId } = req.body;
    if (!taskId || !targetTaskId) return res.status(400).json({ error: 'Se requiere taskId y targetTaskId' });

    db.all('SELECT id, sort_order FROM tasks WHERE parent_id IS NULL AND user_id = ? ORDER BY sort_order ASC, id ASC',
        [req.viewUserId],
        (err, tasks) => {
            if (err) return res.status(500).json({ error: err.message });

            const draggedIndex = tasks.findIndex(t => t.id == taskId);
            const targetIndex = tasks.findIndex(t => t.id == targetTaskId);
            if (draggedIndex === -1 || targetIndex === -1) return res.status(404).json({ error: 'Tarea no encontrada' });

            const reordered = [...tasks];
            const [dragged] = reordered.splice(draggedIndex, 1);
            reordered.splice(targetIndex, 0, dragged);

            const updates = reordered.map((task, index) =>
                new Promise((resolve, reject) => {
                    db.run('UPDATE tasks SET sort_order = ? WHERE id = ?', [index, task.id],
                        (err) => err ? reject(err) : resolve());
                })
            );

            Promise.all(updates)
                .then(() => { invalidateStatsCache(req.viewUserId); res.json({ message: 'Tarea reordenada exitosamente', taskId, newPosition: targetIndex }); })
                .catch(err => res.status(500).json({ error: err.message }));
        }
    );
});

app.post('/api/tasks/:id/reparent', requireAuth, resolveViewUser, (req, res) => {
    if (req.isReadOnly) return res.status(403).json({ error: 'Solo tienes permiso de lectura en este plan' });

    const taskId = req.params.id;
    const { newParentId } = req.body;

    if (newParentId === null || newParentId === undefined) {
        db.run('UPDATE tasks SET parent_id = NULL, is_subtask = 0 WHERE id = ? AND user_id = ?',
            [taskId, req.viewUserId],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                if (this.changes === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
                invalidateStatsCache(req.viewUserId);
                res.json({ message: 'Tarea promovida a tarea principal' });
            }
        );
    } else {
        db.get('SELECT id, is_subtask FROM tasks WHERE id = ? AND user_id = ?', [newParentId, req.viewUserId], (err, parentTask) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!parentTask) return res.status(404).json({ error: 'Tarea padre no encontrada' });
            if (parentTask.is_subtask) return res.status(400).json({ error: 'No se puede anidar más de un nivel' });
            if (parentTask.id == taskId) return res.status(400).json({ error: 'Una tarea no puede ser su propio padre' });

            db.run('UPDATE tasks SET parent_id = ?, is_subtask = 1 WHERE id = ? AND user_id = ?',
                [newParentId, taskId, req.viewUserId],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    if (this.changes === 0) return res.status(404).json({ error: 'Tarea no encontrada' });
                    invalidateStatsCache(req.viewUserId);
                    res.json({ message: 'Tarea convertida en subtarea' });
                }
            );
        });
    }
});

// ── Exportar a Excel ─────────────────────────────────────────────────────────

app.post('/api/export', requireAuth, resolveViewUser, async (req, res) => {
    try {
        const { title, filename } = req.body;

        const allRows = await new Promise((resolve, reject) => {
            db.all(
                `SELECT * FROM tasks WHERE user_id = ?
                 ORDER BY CASE WHEN parent_id IS NULL THEN sort_order ELSE parent_id END,
                          parent_id IS NULL DESC, sort_order ASC`,
                [req.viewUserId],
                (err, rows) => err ? reject(err) : resolve(rows)
            );
        });

        const taskMap = {};
        const parents = [];
        allRows.forEach(r => { r.subtasks = []; taskMap[r.id] = r; });
        allRows.forEach(r => {
            if (r.parent_id && taskMap[r.parent_id]) taskMap[r.parent_id].subtasks.push(r);
            else if (!r.parent_id) parents.push(r);
        });

        const statusLabel = { pending: 'Pendiente', in_progress: 'En progreso', done: 'Completada' };

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'QuickPlan by andyjara-dev';
        workbook.created = new Date();

        const worksheet = workbook.addWorksheet('Tareas QuickPlan');
        worksheet.columns = [
            { header: 'ID',            key: 'id',            width: 8  },
            { header: 'Tarea',         key: 'tarea',         width: 42 },
            { header: 'Estado',        key: 'status',        width: 14 },
            { header: 'Horas',         key: 'horas',         width: 10 },
            { header: 'Observaciones', key: 'observaciones', width: 46 },
            { header: 'Recurso',       key: 'recurso',       width: 20 },
            { header: 'Fecha',         key: 'created_at',    width: 14 },
        ];

        worksheet.insertRow(1, [title || 'Reporte QuickPlan']);
        worksheet.mergeCells('A1:G1');
        const titleCell = worksheet.getCell('A1');
        titleCell.font = { size: 18, bold: true, color: { argb: 'FF2196F3' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } };

        worksheet.insertRow(2, [`Generado el: ${new Date().toLocaleDateString('es-ES')} a las ${new Date().toLocaleTimeString('es-ES')}`]);
        worksheet.mergeCells('A2:G2');
        const dateCell = worksheet.getCell('A2');
        dateCell.alignment = { horizontal: 'center' };
        dateCell.font = { size: 11, italic: true };

        const totalHoras = parents.reduce((sum, t) => sum + (parseFloat(t.horas) || 0), 0);
        const totalSubtareas = allRows.filter(r => r.parent_id).length;
        worksheet.insertRow(3, [`Tareas: ${parents.length} | Subtareas: ${totalSubtareas} | Horas totales: ${totalHoras} | andyjara-dev`]);
        worksheet.mergeCells('A3:G3');
        const summaryCell = worksheet.getCell('A3');
        summaryCell.alignment = { horizontal: 'center' };
        summaryCell.font = { size: 10, bold: true };

        worksheet.insertRow(4, []);

        parents.forEach(task => {
            worksheet.addRow({
                id: task.id, tarea: task.tarea, status: statusLabel[task.status] || 'Pendiente',
                horas: parseFloat(task.horas) || 0, observaciones: task.observaciones || '',
                recurso: task.recurso || '', created_at: new Date(task.created_at).toLocaleDateString('es-ES')
            });
            task.subtasks.forEach(sub => {
                worksheet.addRow({
                    id: sub.id, tarea: '    ↳ ' + sub.tarea, status: statusLabel[sub.status] || 'Pendiente',
                    horas: parseFloat(sub.horas) || 0, observaciones: sub.observaciones || '',
                    recurso: sub.recurso || task.recurso || '', created_at: new Date(sub.created_at).toLocaleDateString('es-ES')
                });
            });
        });

        const headerRow = worksheet.getRow(5);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1976D2' } };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

        let rowIdx = 6;
        let even = false;
        parents.forEach(task => {
            const r = worksheet.getRow(rowIdx);
            r.font = { size: 9 }; r.height = 28;
            if (even) r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } };
            worksheet.getCell(`E${rowIdx}`).alignment = { wrapText: true, vertical: 'top' };
            rowIdx++; even = !even;
            task.subtasks.forEach(() => {
                const sr = worksheet.getRow(rowIdx);
                sr.font = { size: 9, italic: true }; sr.height = 22;
                sr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
                worksheet.getCell(`E${rowIdx}`).alignment = { wrapText: true, vertical: 'top' };
                rowIdx++;
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        res.set({
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="${filename || 'quickplan-reporte'}.xlsx"`,
            'Content-Length': buffer.length
        });
        res.send(buffer);
    } catch (error) {
        console.error('❌ Error generando Excel:', error);
        res.status(500).json({ error: 'Error generando archivo Excel: ' + error.message });
    }
});

// ── Estadísticas con cache por usuario ──────────────────────────────────────

const statsCacheMap = new Map(); // userId → { data, time }
const STATS_CACHE_TTL = 30000;

function invalidateStatsCache(userId) {
    statsCacheMap.delete(userId);
}

app.get('/api/stats', requireAuth, resolveViewUser, (req, res) => {
    const userId = req.viewUserId;
    const now = Date.now();
    const cached = statsCacheMap.get(userId);
    if (cached && (now - cached.time) < STATS_CACHE_TTL) return res.json(cached.data);

    db.all(
        `SELECT
            COUNT(CASE WHEN is_subtask = 0 THEN 1 END) as total_tareas,
            SUM(CASE WHEN is_subtask = 0 THEN horas ELSE 0 END) as total_horas,
            COUNT(DISTINCT recurso) as recursos_unicos,
            AVG(CASE WHEN is_subtask = 0 THEN horas END) as promedio_horas
         FROM tasks WHERE user_id = ?`,
        [userId],
        (err, stats) => {
            if (err) return res.status(500).json({ error: err.message });
            statsCacheMap.set(userId, { data: stats[0], time: now });
            res.json(stats[0]);
        }
    );
});

// ── Archivos estáticos con ruta explícita (respaldo) ─────────────────────────

app.get('/logo.png', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'logo.png'));
});

// ── Cifrado de ajustes ────────────────────────────────────────────────────────

const MASTER_SECRET = process.env.SESSION_SECRET || 'quickplan-dev-secret-change-in-prod';
const ENC_KEY = crypto.scryptSync(MASTER_SECRET, 'qp-settings-salt', 32);

function encryptValue(plain) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return { value_enc: enc.toString('hex'), iv: iv.toString('hex'), auth_tag: cipher.getAuthTag().toString('hex') };
}

function decryptValue(value_enc, iv, auth_tag) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(auth_tag, 'hex'));
    return decipher.update(value_enc, 'hex', 'utf8') + decipher.final('utf8');
}

function getUserSetting(userId, key) {
    return new Promise((resolve) => {
        db.get('SELECT value_enc, iv, auth_tag FROM user_settings WHERE user_id=? AND key=?', [userId, key], (err, row) => {
            if (err || !row) return resolve(null);
            try { resolve(decryptValue(row.value_enc, row.iv, row.auth_tag)); }
            catch { resolve(null); }
        });
    });
}

function setUserSetting(userId, key, value) {
    const { value_enc, iv, auth_tag } = encryptValue(value);
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO user_settings (user_id, key, value_enc, iv, auth_tag) VALUES (?,?,?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value_enc=excluded.value_enc, iv=excluded.iv, auth_tag=excluded.auth_tag',
            [userId, key, value_enc, iv, auth_tag],
            (err) => err ? reject(err) : resolve()
        );
    });
}

// Rutas de configuración
app.get('/api/settings', requireAuth, async (req, res) => {
    const anthropicKey = await getUserSetting(req.user.id, 'anthropic_api_key');
    const geminiKey = await getUserSetting(req.user.id, 'gemini_api_key');
    res.json({
        has_anthropic_key: !!anthropicKey,
        has_gemini_key: !!geminiKey,
        anthropic_key_preview: anthropicKey ? anthropicKey.slice(0, 8) + '…' : null,
        gemini_key_preview: geminiKey ? geminiKey.slice(0, 8) + '…' : null
    });
});

app.put('/api/settings', requireAuth, async (req, res) => {
    const { anthropic_api_key, gemini_api_key } = req.body;
    try {
        if (anthropic_api_key !== undefined) {
            if (anthropic_api_key === '') {
                db.run('DELETE FROM user_settings WHERE user_id=? AND key=?', [req.user.id, 'anthropic_api_key']);
            } else {
                await setUserSetting(req.user.id, 'anthropic_api_key', anthropic_api_key);
            }
        }
        if (gemini_api_key !== undefined) {
            if (gemini_api_key === '') {
                db.run('DELETE FROM user_settings WHERE user_id=? AND key=?', [req.user.id, 'gemini_api_key']);
            } else {
                await setUserSetting(req.user.id, 'gemini_api_key', gemini_api_key);
            }
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Toma de Requerimientos ────────────────────────────────────────────────────

const REQUIREMENTS_SYSTEM_PROMPT = `Eres un experto en levantamiento de requerimientos de software de la suite Planning by andyjara.dev.
Tu rol es:
1. Hacer preguntas específicas y concisas para entender el proyecto/sistema a construir
2. Identificar actores, funcionalidades, restricciones y prioridades
3. Proponer un plan estructurado con tareas, horas estimadas y recursos sugeridos
4. Cuando el usuario lo solicite, generar un documento formal de requerimientos
5. Cuando el usuario solicite importar tareas, responder ÚNICAMENTE con un JSON válido con este formato exacto:
   {"tasks":[{"tarea":"nombre tarea","horas":N,"recurso":"recurso","observaciones":"obs","subtasks":[{"tarea":"sub","horas":N,"recurso":"rec","observaciones":"obs"}]}]}

Responde siempre en español. Sé conciso pero completo. Haz máximo 3 preguntas por mensaje.`;

const MAX_MESSAGES_BEFORE_SUMMARY = 10;
const MESSAGES_TO_KEEP_AFTER_SUMMARY = 6;

function toClaudeMsg(m) {
    if (m.role === 'assistant') return { role: 'assistant', content: m.content || '' };
    // user message — may have image
    if (m.image) {
        return {
            role: 'user',
            content: [
                { type: 'image', source: { type: 'base64', media_type: m.image.mediaType, data: m.image.data } },
                { type: 'text', text: m.content || 'Analiza esta imagen en el contexto del levantamiento de requerimientos.' }
            ]
        };
    }
    return { role: 'user', content: m.content || '' };
}

function toGeminiHistory(m) {
    if (m.image) {
        return {
            role: 'user',
            parts: [
                { inlineData: { mimeType: m.image.mediaType, data: m.image.data } },
                { text: m.content || 'Analiza esta imagen en el contexto del levantamiento de requerimientos.' }
            ]
        };
    }
    return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content || '' }] };
}

async function callAI(provider, messages, contextSummary, apiKey, maxTokens = 1024) {
    if (!apiKey) throw new Error(`No hay API key configurada para ${provider}. Configúrala en ⚙ Ajustes.`);

    const historyToSend = messages.length > MAX_MESSAGES_BEFORE_SUMMARY
        ? messages.slice(-MESSAGES_TO_KEEP_AFTER_SUMMARY)
        : messages;

    const systemWithSummary = contextSummary
        ? `${REQUIREMENTS_SYSTEM_PROMPT}\n\n## Contexto previo resumido:\n${contextSummary}`
        : REQUIREMENTS_SYSTEM_PROMPT;

    if (provider === 'gemini') {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: 'gemini-1.5-flash',
            generationConfig: { maxOutputTokens: maxTokens }
        });
        const last = historyToSend[historyToSend.length - 1];
        const chat = model.startChat({
            systemInstruction: systemWithSummary,
            history: historyToSend.slice(0, -1).map(toGeminiHistory)
        });
        const lastParts = last.image
            ? [{ inlineData: { mimeType: last.image.mediaType, data: last.image.data } }, { text: last.content || 'Analiza esta imagen.' }]
            : last.content || '';
        const result = await chat.sendMessage(lastParts);
        return result.response.text();
    } else {
        const anthropic = new Anthropic({ apiKey });
        const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: maxTokens,
            system: systemWithSummary,
            messages: historyToSend.map(toClaudeMsg)
        });
        return response.content[0].text;
    }
}

async function generateContextSummary(provider, messages, apiKey) {
    const summaryPrompt = 'Resume en máximo 300 palabras los requerimientos discutidos hasta ahora: actores, funcionalidades clave, restricciones y decisiones tomadas.';
    const msgs = [...messages, { role: 'user', content: summaryPrompt }];
    return callAI(provider, msgs, '', apiKey);
}

// ── Prompt síntesis de documento ─────────────────────────────────────────────

const DOC_GENERATION_PROMPT = `Basado EXCLUSIVAMENTE en la información presente en esta conversación, genera un documento técnico de requerimientos estructurado.
REGLAS ESTRICTAS:
- NO inventes información que no haya sido mencionada explícitamente en la conversación.
- NO agregues secciones, pasos, riesgos ni criterios que no se hayan discutido.
- Si no hay información suficiente para una sección, OMÍTELA completamente.
- Usa solo texto plano (sin asteriscos, sin markdown, sin caracteres especiales).
- Responde ÚNICAMENTE con un JSON válido, sin texto adicional ni bloques de código.

Esquema JSON (incluye solo los campos con información real de la conversación):
{
  "title": "título del proyecto mencionado",
  "subtitle": "Documento de Requerimiento Tecnico",
  "company": "empresa o cliente si fue mencionado",
  "responsible": "responsable si fue mencionado",
  "version": "1.0",
  "sections": [
    { "type": "context",       "title": "Antecedentes",               "content": "solo lo mencionado en la conversacion" },
    { "type": "current",       "title": "Situacion Actual",           "content": "descripcion general", "steps": [{"title":"Nombre paso","desc":"descripcion breve"}] },
    { "type": "problem",       "title": "Problematica",               "items": ["solo problemas mencionados"] },
    { "type": "target",        "title": "Modelo Objetivo",            "content": "descripcion general", "steps": [{"title":"Nombre paso","desc":"descripcion breve"}] },
    { "type": "functional",    "title": "Requerimientos Funcionales", "items": [{"id":"RF-01","text":"descripcion"}] },
    { "type": "nonfunctional", "title": "Requerimientos No Funcionales", "items": [{"id":"RNF-01","text":"descripcion"}] },
    { "type": "risks",         "title": "Riesgos Identificados",      "items": [{"level":"Alto","text":"riesgo","mitigation":"mitigacion"}] },
    { "type": "roadmap",       "title": "Roadmap Estimado",           "phases": [{"name":"Fase 1","duration":"Semanas 1-3","title":"nombre fase","items":"tarea 1 · tarea 2 · tarea 3"}] },
    { "type": "acceptance",    "title": "Criterios de Aceptacion",    "items": ["criterio mencionado"] }
  ],
  "estimation": "estimacion si fue discutida en la conversacion"
}`;

async function generateDocContent(provider, messages, contextSummary, apiKey) {
    const msgsWithPrompt = [
        ...messages.filter(m => m.role !== 'system'),
        { role: 'user', content: DOC_GENERATION_PROMPT }
    ];
    const raw = await callAI(provider, msgsWithPrompt, contextSummary, apiKey, 4096);
    console.log('[generateDocContent] raw length:', raw?.length, 'preview:', raw?.slice(0, 200));
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('La IA no devolvió JSON válido. Respuesta: ' + raw?.slice(0, 300));
    try {
        return JSON.parse(match[0]);
    } catch (parseErr) {
        throw new Error('JSON inválido de la IA: ' + parseErr.message + ' — fragmento: ' + match[0].slice(-200));
    }
}

// ── Paletas del documento ─────────────────────────────────────────────────────
const PDF_THEME = {
    BG:       '#0d1117',
    CARD:     '#141829',
    ELEVATED: '#1e2640',
    ACCENT:   '#4f8ef7',
    SUCCESS:  '#10b981',
    WARNING:  '#f59e0b',
    DANGER:   '#ef4444',
    TEXT:     '#e2e8f0',
    MUTED:    '#94a3b8',
    FAINT:    '#64748b',
    BORDER:   '#1e293b',
};

const PDF_LIGHT_THEME = {
    BG:       '#ffffff',
    CARD:     '#f5f5f3',
    ELEVATED: '#ebebea',
    ACCENT:   '#0C447C',
    SUCCESS:  '#1D9E75',
    WARNING:  '#8B5E00',
    DANGER:   '#9B2020',
    TEXT:     '#1a1a1a',
    MUTED:    '#555555',
    FAINT:    '#888888',
    BORDER:   '#e5e5e5',
};

function parseMsgParts(content) {
    const parts = [];
    const re = /```(?:mermaid)?\n?([\s\S]*?)```/g;
    let last = 0, m, idx = 0;
    while ((m = re.exec(content)) !== null) {
        if (m.index > last) parts.push({ type: 'text', content: content.slice(last, m.index) });
        const isMermaid = content.slice(m.index, m.index + 12).includes('mermaid');
        parts.push({ type: isMermaid ? 'diagram' : 'code', content: m[1].trim(), idx: idx++ });
        last = re.lastIndex;
    }
    if (last < content.length) parts.push({ type: 'text', content: content.slice(last) });
    return parts.length ? parts : [{ type: 'text', content }];
}

function buildStructuredDocx(doc) {
    const T = PDF_THEME;
    const date = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
    const children = [];
    const p = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text: text || '', ...opts })], ...opts._par });
    const blank = () => new Paragraph({ text: '' });
    const accent = c => c.replace('#', '');

    // Cover
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Planning by andyjara.dev', bold: true, color: accent(T.ACCENT), size: 24 })] }));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: doc.title || 'Documento de Requerimientos', bold: true, color: 'E2E8F0', size: 40 })] }));
    if (doc.subtitle) children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: doc.subtitle, color: '94A3B8', size: 20 })] }));
    children.push(blank());

    const meta = [['Empresa', doc.company], ['Responsable', doc.responsible], ['Versión', doc.version || '1.0'], ['Fecha', date]].filter(([,v]) => v);
    if (meta.length) {
        children.push(new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [new TableRow({ children: meta.map(([l, v]) => new TableCell({
                shading: { type: 'clear', color: 'auto', fill: accent(T.CARD) },
                children: [
                    new Paragraph({ children: [new TextRun({ text: l.toUpperCase(), color: '64748B', size: 16 })] }),
                    new Paragraph({ children: [new TextRun({ text: v, bold: true, color: 'E2E8F0', size: 20 })] })
                ]
            })) })]
        }));
        children.push(blank());
    }

    let sNum = 1;
    for (const sec of (doc.sections || [])) {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: `${sNum++}. ${sec.title.toUpperCase()}`, bold: true, color: accent(T.ACCENT) })] }));

        if (sec.content) children.push(new Paragraph({ children: [new TextRun({ text: sec.content, color: 'E2E8F0', size: 20 })] }));

        if (sec.steps) {
            for (const step of sec.steps) {
                children.push(new Paragraph({ children: [new TextRun({ text: '▶  ' + step.title, bold: true, color: accent(T.ACCENT), size: 20 })] }));
                children.push(new Paragraph({ indent: { left: 300 }, children: [new TextRun({ text: step.desc, color: '94A3B8', size: 18 })] }));
            }
        }

        if (sec.items && sec.type === 'functional' || sec.type === 'nonfunctional') {
            const items = sec.items || [];
            for (const item of items) {
                const id = item.id || '';
                const text = item.text || item;
                children.push(new Paragraph({ children: [new TextRun({ text: `${id}  `, bold: true, color: accent(T.ACCENT), size: 18 }), new TextRun({ text: text, color: 'E2E8F0', size: 18 })] }));
            }
        } else if (Array.isArray(sec.items)) {
            for (const item of sec.items) {
                if (typeof item === 'string') {
                    children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: item, color: 'E2E8F0', size: 19 })] }));
                } else if (item.level) {
                    const lvlColor = item.level === 'Alto' ? 'EF4444' : item.level === 'Medio' ? 'F59E0B' : '10B981';
                    children.push(new Paragraph({ children: [new TextRun({ text: `[${item.level}]  `, bold: true, color: lvlColor, size: 18 }), new TextRun({ text: item.text, bold: true, color: 'E2E8F0', size: 18 })] }));
                    if (item.mitigation) children.push(new Paragraph({ indent: { left: 300 }, children: [new TextRun({ text: 'Mitigación: ' + item.mitigation, color: '94A3B8', size: 17, italics: true })] }));
                }
            }
        }

        if (sec.phases) {
            for (const ph of sec.phases) {
                children.push(new Paragraph({ children: [new TextRun({ text: `${ph.name} · ${ph.duration}`, bold: true, color: accent(T.ACCENT), size: 18 })] }));
                children.push(new Paragraph({ children: [new TextRun({ text: ph.title, bold: true, color: 'E2E8F0', size: 19 })] }));
                if (ph.items) children.push(new Paragraph({ indent: { left: 300 }, children: [new TextRun({ text: ph.items, color: '94A3B8', size: 17 })] }));
            }
        }

        children.push(blank());
    }

    if (doc.estimation) {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'ESTIMACIÓN', bold: true, color: accent(T.ACCENT) })] }));
        children.push(new Paragraph({ children: [new TextRun({ text: doc.estimation, color: 'E2E8F0', size: 20 })] }));
        children.push(blank());
    }

    children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Generado por Planning by andyjara.dev · ${date}`, color: '64748B', size: 16 })] }));

    return new Document({ sections: [{ properties: {}, children }] });
}

function buildDocxDocument(title, description, messages, userName, diagrams = []) {
    const T = PDF_THEME;
    const date = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });

    const shading = (color) => ({ type: 'clear', color: 'auto', fill: color.replace('#', '') });

    const children = [
        // Cover header
        new Paragraph({
            alignment: AlignmentType.CENTER,
            shading: shading(T.CARD),
            children: [new TextRun({ text: 'Planning by andyjara.dev', bold: true, color: T.ACCENT.replace('#',''), size: 28 })]
        }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            shading: shading(T.BG),
            children: [new TextRun({ text: title, bold: true, color: 'E2E8F0', size: 36 })]
        }),
        new Paragraph({ text: '' }),
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: `Fecha: ${date}   ·   Responsable: ${userName}`, color: '94A3B8', size: 18 })]
        }),
        new Paragraph({ text: '' }),
        new Paragraph({
            children: [new TextRun({ text: '─'.repeat(80), color: T.ACCENT.replace('#',''), size: 16 })]
        }),
        new Paragraph({ text: '' }),
    ];

    if (description) {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: '1. DESCRIPCIÓN GENERAL', color: T.ACCENT.replace('#',''), bold: true })] }));
        children.push(new Paragraph({ children: [new TextRun({ text: description, color: 'E2E8F0' })] }));
        children.push(new Paragraph({ text: '' }));
    }

    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: `${description ? 2 : 1}. CONVERSACIÓN DE LEVANTAMIENTO`, color: T.ACCENT.replace('#',''), bold: true })] }));
    children.push(new Paragraph({ text: '' }));

    let diagramGlobalIdx = 0;
    for (const msg of messages) {
        const isUser = msg.role === 'user';
        const roleColor = isUser ? '4F8EF7' : '10B981';
        const roleName = isUser ? '▶ USUARIO' : '◆ ASISTENTE IA';

        children.push(new Paragraph({
            shading: shading(T.ELEVATED),
            children: [new TextRun({ text: roleName, bold: true, color: roleColor, size: 18 })]
        }));

        const parts = parseMsgParts(msg.content);
        for (const part of parts) {
            if (part.type === 'text') {
                const lines = part.content.trim().split('\n');
                for (const line of lines) {
                    children.push(new Paragraph({
                        indent: { left: 200 },
                        children: [new TextRun({ text: line, color: 'E2E8F0', size: 20 })]
                    }));
                }
            } else if (part.type === 'diagram' || part.type === 'code') {
                children.push(new Paragraph({
                    shading: shading(T.CARD),
                    indent: { left: 200 },
                    children: [new TextRun({ text: part.type === 'diagram' ? '[ Diagrama ]' : '[ Código ]', color: 'F59E0B', bold: true, size: 18 })]
                }));
                const codeLines = part.content.split('\n');
                for (const cl of codeLines) {
                    children.push(new Paragraph({
                        shading: shading(T.CARD),
                        indent: { left: 360 },
                        children: [new TextRun({ text: cl, font: 'Courier New', color: '94A3B8', size: 16 })]
                    }));
                }
                diagramGlobalIdx++;
            }
        }
        children.push(new Paragraph({ text: '' }));
    }

    children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: `Generado por Planning by andyjara.dev · ${date}`, color: '64748B', size: 16 })]
    }));

    return new Document({ sections: [{ properties: {}, children }] });
}

function buildStructuredPdf(res, doc, theme = 'dark') {
    const T = theme === 'light' ? PDF_LIGHT_THEME : PDF_THEME;
    const PW = 595.28, PH = 841.89, M = 48, CW = PW - M * 2;
    const date = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });

    const pdf = new PDFDocument({ margin: M, size: 'A4', autoFirstPage: false, bufferPages: true,
        info: { Title: doc.title, Author: doc.responsible || '', Creator: 'Planning by andyjara.dev' } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${(doc.title||'requerimiento').replace(/[^a-z0-9]/gi,'_')}.pdf"`);
    pdf.pipe(res);

    const bg = () => pdf.save().rect(0,0,PW,PH).fill(T.BG).restore();
    const accentTop = () => pdf.save().rect(0,0,PW,5).fill(T.ACCENT).restore();

    // Ensure every auto-added page (from text overflow) also gets dark background
    // Do NOT reset pdf.y here — PDFKit manages it internally during text wrapping
    pdf.on('pageAdded', () => { bg(); accentTop(); });

    const footer = (pageNum, total) => {
        pdf.save().rect(0,PH-26,PW,26).fill(T.CARD).restore();
        pdf.save().rect(0,PH-2,PW,2).fill(T.ACCENT).restore();
        pdf.fillColor(T.FAINT).font('Helvetica').fontSize(7.5)
            .text('Planning by andyjara.dev', 0, PH-18, { align: 'center', width: PW });
        if (pageNum > 0) pdf.text(`${pageNum}/${total}`, PW-M-10, PH-18, { align: 'right', width: 30 });
    };

    const newPage = () => { pdf.addPage(); bg(); accentTop(); pdf.y = M + 14; };

    const checkPage = (needed = 80) => { if (pdf.y > PH - needed) newPage(); };

    const sectionHeader = (text, num) => {
        checkPage(60);
        const y = pdf.y;
        pdf.save().rect(M-8, y-4, CW+16, 26).fill(T.ELEVATED).restore();
        pdf.save().rect(M-8, y-4, 3, 26).fill(T.ACCENT).restore();
        pdf.fillColor(T.ACCENT).font('Helvetica-Bold').fontSize(9.5)
            .text(`${num}.  ${text.toUpperCase()}`, M+6, y+4, { width: CW });
        pdf.moveDown(0.9);
    };

    const bodyText = (text, indent = 0) => {
        checkPage(40);
        pdf.fillColor(T.TEXT).font('Helvetica').fontSize(9.5)
            .text(text, M+8+indent, pdf.y, { width: CW-16-indent, lineGap: 2.5 });
        pdf.moveDown(0.4);
    };

    const bulletItem = (text, color = T.ACCENT) => {
        checkPage(30);
        const y = pdf.y;
        pdf.save().circle(M+14, y+5, 2.5).fill(color).restore();
        pdf.fillColor(T.TEXT).font('Helvetica').fontSize(9.5)
            .text(text, M+22, y, { width: CW-30, lineGap: 2 });
        pdf.moveDown(0.35);
    };

    const stepBox = (title, desc, color, isLast = false) => {
        checkPage(50);
        const y = pdf.y;
        pdf.save().roundedRect(M+4, y-4, CW-8, 36, 5).fill(T.CARD).restore();
        pdf.save().rect(M+4, y-4, 3, 36).fill(color).restore();
        pdf.fillColor(color).font('Helvetica-Bold').fontSize(9)
            .text(title, M+14, y, { width: CW-24 });
        pdf.fillColor(T.MUTED).font('Helvetica').fontSize(8.5)
            .text(desc, M+14, pdf.y+1, { width: CW-24, lineGap: 1.5 });
        pdf.moveDown(0.5);
        if (!isLast) {
            checkPage(20);
            pdf.fillColor(T.FAINT).font('Helvetica').fontSize(14)
                .text('|', 0, pdf.y, { align: 'center', width: PW });
            pdf.moveDown(0.3);
        }
    };

    const reqCard = (id, text) => {
        checkPage(35);
        const y = pdf.y;
        pdf.save().roundedRect(M+4, y-3, CW-8, 30, 5).fill(T.CARD).restore();
        pdf.save().rect(M+4, y-3, 3, 30).fill(T.ACCENT).restore();
        pdf.fillColor(T.ACCENT).font('Helvetica-Bold').fontSize(8)
            .text(id, M+14, y, { width: 50 });
        pdf.fillColor(T.TEXT).font('Helvetica').fontSize(9)
            .text(text, M+68, y, { width: CW-80, lineGap: 1.5 });
        pdf.moveDown(0.6);
    };

    const riskRow = (level, text, mitigation) => {
        checkPage(40);
        const colors = { Alto: T.DANGER, Medio: T.WARNING, Bajo: T.SUCCESS };
        const col = colors[level] || T.MUTED;
        const y = pdf.y;
        pdf.save().roundedRect(M+4, y-3, 44, 18, 4).fill(col).restore();
        pdf.fillColor('#fff').font('Helvetica-Bold').fontSize(7.5)
            .text(level, M+4, y+3, { width: 44, align: 'center' });
        pdf.fillColor(T.TEXT).font('Helvetica-Bold').fontSize(9)
            .text(text, M+56, y, { width: CW-60, lineGap: 1.5 });
        if (mitigation) {
            pdf.fillColor(T.MUTED).font('Helvetica').fontSize(8.5)
                .text('Mitigación: ' + mitigation, M+56, pdf.y+1, { width: CW-60, lineGap: 1.5 });
        }
        pdf.moveDown(0.6);
        pdf.save().moveTo(M+4, pdf.y-2).lineTo(PW-M-4, pdf.y-2)
            .strokeColor(T.BORDER).lineWidth(0.3).stroke().restore();
        pdf.moveDown(0.2);
    };

    const roadmapPhase = (phase, color) => {
        checkPage(50);
        const y = pdf.y;
        // Dot
        pdf.save().circle(M+12, y+5, 5).fill(color).restore();
        // Vertical line (will be drawn after)
        pdf.fillColor(T.FAINT).font('Helvetica-Bold').fontSize(7.5)
            .text((phase.name || '') + (phase.duration ? ' · ' + phase.duration : ''), M+26, y, { width: CW-30 });
        pdf.fillColor(T.TEXT).font('Helvetica-Bold').fontSize(9.5)
            .text(phase.title || '', M+26, pdf.y+1, { width: CW-30 });
        if (phase.items) {
            pdf.fillColor(T.MUTED).font('Helvetica').fontSize(8.5)
                .text(phase.items, M+26, pdf.y+1, { width: CW-30, lineGap: 1.5 });
        }
        pdf.moveDown(0.8);
    };

    const checkItem = (text) => {
        checkPage(25);
        const y = pdf.y;
        pdf.save().roundedRect(M+8, y+1, 10, 10, 2).fill(T.SUCCESS).restore();
        pdf.fillColor(T.TEXT).font('Helvetica').fontSize(9.5)
            .text(text, M+24, y, { width: CW-28, lineGap: 2 });
        pdf.moveDown(0.35);
    };

    // ── Portada ───────────────────────────────────────────────────────────────
    pdf.addPage(); bg();
    pdf.save().rect(0,0,PW,6).fill(T.ACCENT).restore();
    pdf.save().rect(0,0,PW,210).fill(T.CARD).restore();
    pdf.save().moveTo(0,210).lineTo(PW,158).lineTo(PW,210).fill(T.BG).restore();

    pdf.fillColor(T.TEXT).font('Helvetica-Bold').fontSize(26)
        .text(doc.title || 'Documento de Requerimientos', M, 70, { align: 'center', width: CW, lineGap: 4 });
    if (doc.subtitle) pdf.fillColor(T.MUTED).font('Helvetica').fontSize(10)
        .text(doc.subtitle, M+40, pdf.y+8, { align: 'center', width: CW-80 });

    // Meta cards
    const metaItems = [
        ['EMPRESA', doc.company], ['RESPONSABLE', doc.responsible],
        ['VERSIÓN', doc.version || '1.0'], ['FECHA', date]
    ].filter(([,v]) => v);

    const cardW = Math.min(180, (CW-20) / 2);
    const cardH = 68, cardY = PH*0.6;
    const totalW = metaItems.length <= 2 ? metaItems.length * (cardW+10) : 2*(cardW+10);
    let cx2 = (PW-totalW)/2;
    for (let i = 0; i < metaItems.length; i++) {
        const x = cx2 + (i%2) * (cardW+10);
        const y2 = cardY + Math.floor(i/2) * (cardH+10);
        pdf.save().roundedRect(x, y2, cardW, cardH, 7).fill(T.CARD).restore();
        pdf.save().rect(x, y2, 3, cardH).fill(T.ACCENT).restore();
        pdf.fillColor(T.FAINT).font('Helvetica').fontSize(7.5).text(metaItems[i][0], x+10, y2+10, { width: cardW-14 });
        pdf.fillColor(T.TEXT).font('Helvetica-Bold').fontSize(11).text(metaItems[i][1], x+10, y2+23, { width: cardW-14 });
    }

    // ── Contenido ─────────────────────────────────────────────────────────────
    newPage();

    const STEP_COLORS = ['#AFA9EC','#5DCAA5','#D85A30','#85B7EB','#B4B2A9'];
    const PHASE_COLORS = ['#AFA9EC','#5DCAA5','#378ADD','#D85A30','#888780'];

    let sNum = 1;
    for (const sec of (doc.sections || [])) {
        sectionHeader(sec.title, sNum++);

        switch (sec.type) {
            case 'context':
                if (sec.content) bodyText(sec.content);
                break;

            case 'current':
            case 'target':
                if (sec.content) { bodyText(sec.content); pdf.moveDown(0.4); }
                if (sec.steps) {
                    const steps = sec.steps;
                    steps.forEach((s, i) => stepBox(s.title, s.desc, STEP_COLORS[i % STEP_COLORS.length], i === steps.length - 1));
                }
                break;

            case 'problem':
            case 'acceptance':
                (sec.items || []).forEach(item => {
                    if (sec.type === 'acceptance') checkItem(item);
                    else bulletItem(item);
                });
                break;

            case 'functional':
            case 'nonfunctional':
                (sec.items || []).forEach(item => reqCard(item.id || '', item.text || item));
                break;

            case 'risks':
                (sec.items || []).forEach(item => riskRow(item.level, item.text, item.mitigation));
                break;

            case 'roadmap':
                (sec.phases || []).forEach((ph, i) => roadmapPhase(ph, PHASE_COLORS[i % PHASE_COLORS.length]));
                break;

            default:
                if (sec.content) bodyText(sec.content);
                (sec.items || []).forEach(item => bulletItem(typeof item === 'string' ? item : item.text || ''));
        }

        pdf.moveDown(0.6);
    }

    if (doc.estimation) {
        sectionHeader('Estimación de Esfuerzo', sNum);
        checkPage(50);
        const eY = pdf.y;
        pdf.save().roundedRect(M+4, eY-6, CW-8, 44, 6).fill(T.CARD).restore();
        pdf.save().rect(M+4, eY-6, 3, 44).fill(T.WARNING).restore();
        pdf.fillColor(T.TEXT).font('Helvetica').fontSize(9.5)
            .text(doc.estimation, M+14, eY, { width: CW-24, lineGap: 3 });
        pdf.moveDown(1);
    }

    checkPage(40);
    pdf.moveDown(0.5);
    pdf.save().moveTo(M, pdf.y).lineTo(PW-M, pdf.y).strokeColor(T.ACCENT).lineWidth(0.5).stroke().restore();
    pdf.moveDown(0.5);
    pdf.fillColor(T.FAINT).font('Helvetica').fontSize(7.5)
        .text(`Generado por Planning by andyjara.dev · ${date}`, { align: 'center', width: CW });

    // Page numbers
    const range = pdf.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
        pdf.switchToPage(range.start + i);
        footer(i, range.count - 1);
    }

    pdf.end();
}

function buildPdfDocument(res, title, description, messages, userName, diagrams = []) {
    const T = PDF_THEME;
    const PW = 595.28, PH = 841.89, M = 48, CW = PW - M * 2;
    const date = new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });

    const doc = new PDFDocument({
        margin: M, size: 'A4', autoFirstPage: false,
        bufferPages: true,
        info: { Title: title, Author: userName, Creator: 'Planning by andyjara.dev' }
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/[^a-z0-9]/gi, '_')}.pdf"`);
    doc.pipe(res);

    const bg = () => doc.save().rect(0, 0, PW, PH).fill(T.BG).restore();
    const accentBar = (h = 4) => doc.save().rect(0, 0, PW, h).fill(T.ACCENT).restore();
    const footerBar = () => {
        doc.save().rect(0, PH - 28, PW, 28).fill(T.CARD).restore();
        doc.save().rect(0, PH - 3, PW, 3).fill(T.ACCENT).restore();
        doc.fillColor(T.FAINT).font('Helvetica').fontSize(7.5)
            .text('Planning by andyjara.dev', 0, PH - 19, { align: 'center', width: PW });
    };

    const sectionHeader = (text, num) => {
        if (doc.y > PH - 80) newPage();
        const y = doc.y;
        doc.save().rect(M - 8, y - 4, CW + 16, 26).fill(T.ELEVATED).restore();
        doc.save().rect(M - 8, y - 4, 3, 26).fill(T.ACCENT).restore();
        doc.fillColor(T.ACCENT).font('Helvetica-Bold').fontSize(9.5)
            .text(`${num}.  ${text.toUpperCase()}`, M + 6, y + 4, { width: CW });
        doc.moveDown(0.9);
    };

    const divider = (color = T.BORDER) => {
        doc.save().moveTo(M, doc.y).lineTo(PW - M, doc.y).strokeColor(color).lineWidth(0.4).stroke().restore();
        doc.moveDown(0.5);
    };

    const newPage = () => {
        doc.addPage();
        bg(); accentBar(); footerBar();
        doc.y = M + 14;
    };

    // ── Portada ───────────────────────────────────────────────────────────────
    doc.addPage(); bg();

    // Top accent bar (thick)
    doc.save().rect(0, 0, PW, 6).fill(T.ACCENT).restore();

    // Diagonal decorative gradient band
    doc.save().rect(0, 0, PW, 220).fill(T.CARD).restore();
    doc.save().moveTo(0, 220).lineTo(PW, 160).lineTo(PW, 220).fill(T.BG).restore();

    // Brand
    doc.fillColor(T.ACCENT).font('Helvetica-Bold').fontSize(11)
        .text('Planning by andyjara.dev', M, 52, { align: 'center', width: CW });

    // Accent divider line
    const cx = PW / 2;
    doc.save().moveTo(cx - 50, 72).lineTo(cx + 50, 72).strokeColor(T.ACCENT).lineWidth(1.5).stroke().restore();

    // Title
    doc.fillColor(T.TEXT).font('Helvetica-Bold').fontSize(28)
        .text(title, M, 90, { align: 'center', width: CW, lineGap: 4 });

    // Description subtitle
    if (description) {
        doc.fillColor(T.MUTED).font('Helvetica').fontSize(10.5)
            .text(description, M + 40, doc.y + 10, { align: 'center', width: CW - 80, lineGap: 3 });
    }

    // Metadata card
    const metaTop = PH * 0.62;
    const metaH = 90, metaW = 300, metaX = (PW - metaW) / 2;
    doc.save().roundedRect(metaX, metaTop, metaW, metaH, 8).fill(T.CARD).restore();
    doc.save().rect(metaX, metaTop, 3, metaH).fill(T.ACCENT).restore();

    doc.fillColor(T.FAINT).font('Helvetica').fontSize(7.5)
        .text('FECHA DE GENERACIÓN', metaX + 14, metaTop + 12, { width: metaW - 28 });
    doc.fillColor(T.TEXT).font('Helvetica-Bold').fontSize(10)
        .text(date, metaX + 14, metaTop + 22, { width: metaW - 28 });

    doc.save().moveTo(metaX + 14, metaTop + 38).lineTo(metaX + metaW - 14, metaTop + 38)
        .strokeColor(T.BORDER).lineWidth(0.4).stroke().restore();

    doc.fillColor(T.FAINT).font('Helvetica').fontSize(7.5)
        .text('RESPONSABLE', metaX + 14, metaTop + 46, { width: metaW - 28 });
    doc.fillColor(T.TEXT).font('Helvetica-Bold').fontSize(10)
        .text(userName, metaX + 14, metaTop + 56, { width: metaW - 28 });

    doc.save().moveTo(metaX + 14, metaTop + 72).lineTo(metaX + metaW - 14, metaTop + 72)
        .strokeColor(T.BORDER).lineWidth(0.4).stroke().restore();
    doc.fillColor(T.FAINT).font('Helvetica').fontSize(7.5)
        .text(`Documento generado automáticamente · ${messages.length} mensajes`, metaX + 14, metaTop + 78, { width: metaW - 28 });

    // Bottom
    doc.save().rect(0, PH - 28, PW, 28).fill(T.CARD).restore();
    doc.save().rect(0, PH - 3, PW, 3).fill(T.ACCENT).restore();
    doc.fillColor(T.FAINT).font('Helvetica').fontSize(7.5)
        .text('Planning by andyjara.dev', 0, PH - 19, { align: 'center', width: PW });

    // ── Páginas de contenido ──────────────────────────────────────────────────
    newPage();

    let sectionNum = 1;

    if (description) {
        sectionHeader('Descripción General', sectionNum++);
        doc.fillColor(T.TEXT).font('Helvetica').fontSize(10)
            .text(description, M + 8, doc.y, { width: CW - 16, lineGap: 3 });
        doc.moveDown(1);
        divider();
    }

    sectionHeader('Conversación de Levantamiento', sectionNum++);

    // Build diagram lookup by global index
    const dMap = {};
    (diagrams || []).forEach(d => { dMap[d.idx] = d; });

    let globalDiagIdx = 0;

    for (const msg of messages) {
        const isUser = msg.role === 'user';
        const roleColor = isUser ? T.ACCENT : T.SUCCESS;
        const roleName = isUser ? '▶  USUARIO' : '◆  ASISTENTE IA';

        if (doc.y > PH - 100) newPage();

        // Message header card
        const hY = doc.y;
        doc.save().rect(M - 8, hY - 3, CW + 16, 20).fill(T.ELEVATED).restore();
        doc.save().rect(M - 8, hY - 3, 3, 20).fill(roleColor).restore();
        doc.fillColor(roleColor).font('Helvetica-Bold').fontSize(8)
            .text(roleName, M + 6, hY + 3, { width: CW - 10 });
        doc.moveDown(0.5);

        // Embed user image if present
        if (isUser && msg.image && msg.image.data) {
            try {
                if (doc.y > PH - 180) newPage();
                const imgBuf = Buffer.from(msg.image.data, 'base64');
                const imgW = Math.min(CW - 20, 320);
                const imgX = M + (CW - imgW) / 2;
                doc.save().roundedRect(M + 5, doc.y - 4, CW - 10, imgW * 0.65 + 16, 6).fill(T.ELEVATED).restore();
                doc.image(imgBuf, imgX, doc.y, { width: imgW });
                doc.moveDown(0.5);
            } catch (e) {
                doc.fillColor(T.FAINT).font('Helvetica').fontSize(8).text('[Imagen adjunta]', M + 10, doc.y);
                doc.moveDown(0.3);
            }
        }

        const parts = parseMsgParts(msg.content);
        for (const part of parts) {
            if (part.type === 'text') {
                const txt = part.content.trim();
                if (!txt) continue;
                if (doc.y > PH - 80) newPage();
                doc.fillColor(T.TEXT).font('Helvetica').fontSize(9.5)
                    .text(txt, M + 10, doc.y, { width: CW - 20, lineGap: 2.5 });
            } else {
                // diagram or code block
                const dData = dMap[globalDiagIdx];
                if (part.type === 'diagram' && dData && dData.png) {
                    if (doc.y > PH - 180) newPage();
                    doc.moveDown(0.4);
                    const imgBuf = Buffer.from(dData.png, 'base64');
                    const imgW = Math.min(CW - 20, 380);
                    const imgX = M + (CW - imgW) / 2;
                    // Card background
                    doc.save().roundedRect(M + 5, doc.y - 6, CW - 10, imgW * 0.55 + 28, 6).fill(T.ELEVATED).restore();
                    doc.image(imgBuf, imgX, doc.y, { width: imgW, align: 'center' });
                    doc.moveDown(0.5);
                    doc.fillColor(T.FAINT).font('Helvetica').fontSize(7.5)
                        .text('Diagrama generado por IA', { align: 'center', width: CW });
                    doc.moveDown(0.5);
                } else {
                    // Code block (mermaid source or generic code)
                    if (doc.y > PH - 80) newPage();
                    doc.moveDown(0.3);
                    const codeY = doc.y;
                    const codeLines = part.content.split('\n');
                    const blockH = codeLines.length * 11 + 22;
                    doc.save().roundedRect(M + 5, codeY - 6, CW - 10, blockH, 5).fill(T.ELEVATED).restore();
                    doc.save().rect(M + 5, codeY - 6, 3, blockH).fill(T.WARNING).restore();
                    doc.fillColor(T.WARNING).font('Helvetica-Bold').fontSize(7.5)
                        .text(part.type === 'diagram' ? 'DIAGRAMA (mermaid)' : 'CÓDIGO', M + 14, codeY, { width: CW - 24 });
                    doc.moveDown(0.2);
                    doc.fillColor(T.MUTED).font('Courier').fontSize(7.5)
                        .text(part.content.trim(), M + 14, doc.y, { width: CW - 28, lineGap: 1.5 });
                    doc.moveDown(0.6);
                }
                globalDiagIdx++;
            }
        }
        doc.moveDown(0.5);
        doc.save().moveTo(M + 4, doc.y - 3).lineTo(PW - M - 4, doc.y - 3)
            .strokeColor(T.BORDER).lineWidth(0.3).stroke().restore();
        doc.moveDown(0.4);
    }

    doc.moveDown(1);
    divider(T.ACCENT);
    doc.fillColor(T.FAINT).font('Helvetica').fontSize(7.5)
        .text(`Generado por Planning by andyjara.dev · ${date} · Responsable: ${userName}`, { align: 'center', width: CW });

    // Page numbers
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        if (i === 0) continue; // skip cover
        doc.fillColor(T.FAINT).font('Helvetica').fontSize(7.5)
            .text(`Pág. ${i} / ${range.count - 1}`, PW - M - 40, PH - 20, { width: 40, align: 'right' });
    }

    doc.end();
}

// CRUD requerimientos
app.get('/api/requirements', requireAuth, (req, res) => {
    db.all('SELECT id, title, description, ai_provider, status, created_at, updated_at FROM requirements WHERE user_id = ? ORDER BY updated_at DESC',
        [req.user.id], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
});

app.post('/api/requirements', requireAuth, (req, res) => {
    const { title, description, ai_provider } = req.body;
    if (!title) return res.status(400).json({ error: 'title requerido' });
    db.run('INSERT INTO requirements (user_id, title, description, ai_provider) VALUES (?, ?, ?, ?)',
        [req.user.id, title, description || '', ai_provider || 'claude'],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            db.get('SELECT * FROM requirements WHERE id = ?', [this.lastID], (e, row) => res.json(row));
        });
});

app.get('/api/requirements/:id', requireAuth, (req, res) => {
    db.get('SELECT * FROM requirements WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'No encontrado' });
        row.messages = JSON.parse(row.messages || '[]');
        res.json(row);
    });
});

app.put('/api/requirements/:id', requireAuth, (req, res) => {
    const { title, description, ai_provider, status } = req.body;
    db.run('UPDATE requirements SET title=COALESCE(?,title), description=COALESCE(?,description), ai_provider=COALESCE(?,ai_provider), status=COALESCE(?,status), updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?',
        [title, description, ai_provider, status, req.params.id, req.user.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            db.get('SELECT * FROM requirements WHERE id = ?', [req.params.id], (e, row) => {
                row.messages = JSON.parse(row.messages || '[]');
                res.json(row);
            });
        });
});

app.delete('/api/requirements/:id', requireAuth, (req, res) => {
    db.run('DELETE FROM requirements WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.post('/api/requirements/:id/chat', requireAuth, async (req, res) => {
    const { message, image } = req.body;
    if (!message && !image) return res.status(400).json({ error: 'message o image requerido' });

    db.get('SELECT * FROM requirements WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], async (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'No encontrado' });

        let messages = JSON.parse(row.messages || '[]');
        const userMsg = { role: 'user', content: message || '' };
        if (image && image.data && image.mediaType) userMsg.image = { data: image.data, mediaType: image.mediaType };
        messages.push(userMsg);

        try {
            const settingKey = row.ai_provider === 'gemini' ? 'gemini_api_key' : 'anthropic_api_key';
            const apiKey = await getUserSetting(req.user.id, settingKey);
            const aiReply = await callAI(row.ai_provider, messages, row.context_summary, apiKey);
            messages.push({ role: 'assistant', content: aiReply });

            let newSummary = row.context_summary;
            if (messages.length >= MAX_MESSAGES_BEFORE_SUMMARY && messages.length % MAX_MESSAGES_BEFORE_SUMMARY === 0) {
                try {
                    newSummary = await generateContextSummary(row.ai_provider, messages, apiKey);
                    messages = messages.slice(-MESSAGES_TO_KEEP_AFTER_SUMMARY);
                } catch (e) {
                    console.warn('No se pudo generar resumen:', e.message);
                }
            }

            db.run('UPDATE requirements SET messages=?, context_summary=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
                [JSON.stringify(messages), newSummary, row.id], (e) => {
                    if (e) return res.status(500).json({ error: e.message });
                    res.json({ reply: aiReply, messages });
                });
        } catch (e) {
            console.error('Error AI:', e.message);
            res.status(500).json({ error: `Error del proveedor IA: ${e.message}` });
        }
    });
});

app.post('/api/requirements/:id/generate-doc', requireAuth, async (req, res) => {
    db.get('SELECT * FROM requirements WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], async (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'No encontrado' });
        const messages = JSON.parse(row.messages || '[]');
        if (!messages.length) return res.status(400).json({ error: 'No hay conversación para sintetizar' });
        try {
            const settingKey = row.ai_provider === 'gemini' ? 'gemini_api_key' : 'anthropic_api_key';
            const apiKey = await getUserSetting(req.user.id, settingKey);
            const docJson = await generateDocContent(row.ai_provider, messages, row.context_summary, apiKey);
            db.run('UPDATE requirements SET doc_content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
                [JSON.stringify(docJson), row.id]);
            res.json(docJson);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
});

app.post('/api/requirements/:id/export', requireAuth, async (req, res) => {
    const { format, regenerate, theme } = req.body;
    db.get('SELECT * FROM requirements WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], async (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'No encontrado' });

        const messages = JSON.parse(row.messages || '[]');
        let docJson = (row.doc_content && !regenerate) ? JSON.parse(row.doc_content) : null;

        if (!docJson && messages.length) {
            try {
                const settingKey = row.ai_provider === 'gemini' ? 'gemini_api_key' : 'anthropic_api_key';
                const apiKey = await getUserSetting(req.user.id, settingKey);
                docJson = await generateDocContent(row.ai_provider, messages, row.context_summary, apiKey);
                db.run('UPDATE requirements SET doc_content=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
                    [JSON.stringify(docJson), row.id]);
            } catch (e) {
                return res.status(500).json({ error: 'Error generando documento: ' + e.message });
            }
        }

        if (!docJson) return res.status(400).json({ error: 'No hay conversación para exportar' });

        if (format === 'pdf') {
            buildStructuredPdf(res, docJson, theme || 'dark');
        } else {
            try {
                const wordDoc = buildStructuredDocx(docJson);
                const buffer = await Packer.toBuffer(wordDoc);
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                res.setHeader('Content-Disposition', `attachment; filename="${(docJson.title||row.title).replace(/[^a-z0-9]/gi,'_')}.docx"`);
                res.send(buffer);
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        }
    });
});

app.post('/api/requirements/:id/import-tasks', requireAuth, async (req, res) => {
    db.get('SELECT * FROM requirements WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], async (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'No encontrado' });

        const messages = JSON.parse(row.messages || '[]');
        const importPrompt = 'Genera ÚNICAMENTE el JSON de tareas para importar al sistema. Sin explicación, solo el JSON con el formato: {"tasks":[{"tarea":"...","horas":N,"recurso":"...","observaciones":"...","subtasks":[]}]}';
        const msgsWithPrompt = [...messages, { role: 'user', content: importPrompt }];

        try {
            const settingKey = row.ai_provider === 'gemini' ? 'gemini_api_key' : 'anthropic_api_key';
            const apiKey = await getUserSetting(req.user.id, settingKey);
            const aiReply = await callAI(row.ai_provider, msgsWithPrompt, row.context_summary, apiKey);
            const jsonMatch = aiReply.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return res.status(422).json({ error: 'El IA no generó JSON válido', raw: aiReply });

            const { tasks } = JSON.parse(jsonMatch[0]);
            if (!Array.isArray(tasks)) return res.status(422).json({ error: 'Formato de tareas inválido' });

            const userId = req.user.id;
            let created = 0;

            const insertTask = (task, parentId) => new Promise((resolve, reject) => {
                const table = parentId ? 'tasks' : 'tasks';
                db.get('SELECT MAX(sort_order) as maxOrder FROM tasks WHERE user_id = ? AND is_subtask = 0', [userId], (e, r) => {
                    const sortOrder = ((r && r.maxOrder) || 0) + 1;
                    if (parentId) {
                        db.run('INSERT INTO tasks (tarea, horas, recurso, observaciones, user_id, parent_id, is_subtask, sort_order) VALUES (?,?,?,?,?,?,1,?)',
                            [task.tarea, task.horas || 0, task.recurso || '', task.observaciones || '', userId, parentId, sortOrder],
                            function(err) { if (err) reject(err); else { created++; resolve(this.lastID); } });
                    } else {
                        db.run('INSERT INTO tasks (tarea, horas, recurso, observaciones, user_id, sort_order) VALUES (?,?,?,?,?,?)',
                            [task.tarea, task.horas || 0, task.recurso || '', task.observaciones || '', userId, sortOrder],
                            function(err) { if (err) reject(err); else { created++; resolve(this.lastID); } });
                    }
                });
            });

            for (const task of tasks) {
                const parentId = await insertTask(task, null);
                if (task.subtasks && Array.isArray(task.subtasks)) {
                    for (const sub of task.subtasks) {
                        await insertTask(sub, parentId);
                    }
                }
            }

            invalidateStatsCache(userId);
            res.json({ success: true, created });
        } catch (e) {
            console.error('Error import-tasks:', e.message);
            res.status(500).json({ error: e.message });
        }
    });
});

// ── SPA fallback ─────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Arranque ─────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('⚡ QuickPlan - Sistema de Gestión de Tareas');
    console.log('==========================================');
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`🌐 URL local: http://localhost:${PORT}`);
    console.log(`📅 Iniciado: ${new Date().toLocaleString('es-ES')}`);
    console.log(`💾 Base de datos: ${dbPath}`);
    console.log('==========================================');
});

process.on('SIGINT', () => {
    db.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
    db.close();
    process.exit(0);
});
