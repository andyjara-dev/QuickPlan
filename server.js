const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const ExcelJS = require('exceljs');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar trust proxy ANTES de rate limiting
app.set('trust proxy', 1);

// Crear directorio data si no existe
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}


// Configuración de seguridad
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

// Middleware
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Autenticación básica opcional (activar con AUTH_USER y AUTH_PASS env vars)
if (process.env.AUTH_USER && process.env.AUTH_PASS) {
    app.use((req, res, next) => {
        if (req.path === '/health') return next();
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            res.set('WWW-Authenticate', 'Basic realm="QuickPlan"');
            return res.status(401).send('Autenticación requerida');
        }
        const credentials = Buffer.from(authHeader.slice(6), 'base64').toString('utf-8');
        const colonIdx = credentials.indexOf(':');
        const user = credentials.slice(0, colonIdx);
        const pass = credentials.slice(colonIdx + 1);
        if (user !== process.env.AUTH_USER || pass !== process.env.AUTH_PASS) {
            res.set('WWW-Authenticate', 'Basic realm="QuickPlan"');
            return res.status(401).send('Credenciales inválidas');
        }
        next();
    });
    console.log('🔒 Autenticación básica activada (AUTH_USER / AUTH_PASS)');
}

// Rate limiting mejorado para resolver 503 intermitente
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // máximo 100 requests por IP
    message: { error: 'Demasiadas solicitudes, intenta en 15 minutos' }
});

// Rate limiting específico para refresh frecuente (evitar 503)
const refreshLimiter = rateLimit({
    windowMs: 2000, // 2 segundos
    max: 5, // máximo 5 requests cada 2 segundos
    message: { error: 'Refresh muy frecuente, espera un momento' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // No aplicar límite a health checks
        return req.path === '/health' || req.path === '/api/health';
    }
});

// Aplicar rate limiting
app.use('/api/', limiter);
app.use('/', refreshLimiter);

// Inicializar base de datos
const dbPath = path.join(dataDir, 'tasks.db');
console.log('📁 Base de datos en:', dbPath);

// Configuración optimizada de SQLite para manejo concurrente
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('❌ Error conectando a la base de datos:', err);
    } else {
        console.log('✅ Conectado a la base de datos SQLite');
        
        // Configuraciones para mejor rendimiento concurrente
        db.run('PRAGMA journal_mode = WAL;'); // Write-Ahead Logging para concurrencia
        db.run('PRAGMA synchronous = NORMAL;'); // Balance entre seguridad y velocidad
        db.run('PRAGMA cache_size = 1000;'); // Cache de páginas en memoria
        db.run('PRAGMA temp_store = memory;'); // Tablas temporales en memoria
        db.run('PRAGMA busy_timeout = 5000;'); // Timeout para locks (5 segundos)
        
        console.log('⚡ SQLite optimizado para concurrencia');
    }
});

// Crear tabla si no existe
db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tarea TEXT NOT NULL,
        horas REAL DEFAULT 0,
        observaciones TEXT DEFAULT '',
        recurso TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) {
        console.error('❌ Error creando tabla:', err);
    } else {
        console.log('✅ Tabla de tareas lista');
        
        // Verificar y agregar columnas necesarias para subtareas
        db.run(`ALTER TABLE tasks ADD COLUMN sort_order INTEGER DEFAULT 0`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('❌ Error agregando columna sort_order:', err);
            } else if (!err) {
                console.log('✅ Columna sort_order agregada');
            }
        });
        
        db.run(`ALTER TABLE tasks ADD COLUMN parent_id INTEGER DEFAULT NULL`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('❌ Error agregando columna parent_id:', err);
            } else if (!err) {
                console.log('✅ Columna parent_id agregada');
            }
        });
        
        db.run(`ALTER TABLE tasks ADD COLUMN is_subtask INTEGER DEFAULT 0`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('❌ Error agregando columna is_subtask:', err);
            } else if (!err) {
                console.log('✅ Columna is_subtask agregada');
            }
        });

        db.run(`ALTER TABLE tasks ADD COLUMN status TEXT DEFAULT 'pending'`, (err) => {
            if (err && !err.message.includes('duplicate column name')) {
                console.error('❌ Error agregando columna status:', err);
            } else if (!err) {
                console.log('✅ Columna status agregada');
            }
        });
    }
});

// Insertar datos de ejemplo si la tabla está vacía
db.get('SELECT COUNT(*) as count FROM tasks', (err, row) => {
    if (!err && row.count === 0) {
        console.log('📝 Insertando datos de ejemplo...');
        const ejemplos = [
            ['Configuración inicial de QuickPlan', 4, 'Setup completo del sistema', 'andyjara-dev'],
            ['Diseño de interfaz de usuario', 8, 'UI/UX responsivo con Vue.js', 'María González'],
            ['Implementación de exportación Excel', 6, 'Funcionalidad principal con ExcelJS', 'Carlos López']
        ];
        
        ejemplos.forEach(([tarea, horas, obs, recurso]) => {
            db.run('INSERT INTO tasks (tarea, horas, observaciones, recurso) VALUES (?, ?, ?, ?)', 
                   [tarea, horas, obs, recurso]);
        });
    }
});

// Health check endpoint optimizado (sin acceso a DB para evitar competencia)
app.get('/health', (req, res) => {
    // Health check rápido sin DB para evitar locks
    res.json({ 
        status: 'OK', 
        service: 'QuickPlan',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        }
    });
});

// Detailed health check with database test
app.get('/api/health', (req, res) => {
    console.log('🏥 Health check detallado solicitado');
    
    // Test database connection
    db.get("SELECT 1 as test", (err, row) => {
        if (err) {
            console.error('❌ Database health check failed:', err);
            return res.status(503).json({
                status: 'ERROR',
                timestamp: new Date().toISOString(),
                database: 'FAILED',
                error: err.message,
                uptime: process.uptime(),
                memory: process.memoryUsage()
            });
        }
        
        console.log('✅ Health check OK');
        res.status(200).json({
            status: 'OK',
            timestamp: new Date().toISOString(),
            database: 'OK',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            service: 'QuickPlan API',
            version: '1.0.0'
        });
    });
});

// API Routes
app.get('/api/tasks', (req, res) => {
    console.log('📋 Consultando todas las tareas');
    
    // Obtener todas las tareas (padres e hijas) ordenadas correctamente
    db.all('SELECT * FROM tasks ORDER BY CASE WHEN parent_id IS NULL THEN sort_order ELSE parent_id END, parent_id IS NULL DESC, sort_order ASC, created_at DESC', (err, rows) => {
        if (err) {
            console.error('❌ Error consultando tareas:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        
        // Estructurar jerárquicamente
        const taskMap = {};
        const hierarchicalTasks = [];
        
        // Primero crear un mapa de todas las tareas
        rows.forEach(task => {
            task.subtasks = [];
            taskMap[task.id] = task;
        });
        
        // Luego organizar jerárquicamente
        rows.forEach(task => {
            if (task.parent_id) {
                // Es una subtarea
                if (taskMap[task.parent_id]) {
                    taskMap[task.parent_id].subtasks.push(task);
                }
            } else {
                // Es una tarea principal
                hierarchicalTasks.push(task);
            }
        });
        
        console.log(`✅ ${hierarchicalTasks.length} tareas principales con subtareas encontradas`);
        res.json(hierarchicalTasks);
    });
});

app.post('/api/tasks', (req, res) => {
    const { tarea, horas, observaciones, recurso } = req.body;
    
    console.log('➕ Creando nueva tarea:', { tarea, horas, recurso });
    
    if (!tarea || !recurso) {
        return res.status(400).json({ error: 'Tarea y recurso son requeridos' });
    }

    db.run(
        'INSERT INTO tasks (tarea, horas, observaciones, recurso, sort_order) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks))',
        [tarea, parseFloat(horas) || 0, observaciones || '', recurso],
        function(err) {
            if (err) {
                console.error('❌ Error creando tarea:', err);
                res.status(500).json({ error: err.message });
                return;
            }
            console.log(`✅ Tarea creada con ID: ${this.lastID}`);
            invalidateStatsCache(); // Invalidar cache al crear tarea
            res.json({ id: this.lastID, message: 'Tarea creada exitosamente' });
        }
    );
});

// Crear subtarea
app.post('/api/tasks/:parentId/subtasks', (req, res) => {
    const { tarea, horas, observaciones } = req.body;
    const parentId = req.params.parentId;
    const newHours = parseFloat(horas) || 0;
    
    console.log('➕ Creando nueva subtarea para tarea:', parentId, { tarea, horas: newHours });
    
    if (!tarea) {
        return res.status(400).json({ error: 'La subtarea requiere un título' });
    }

    // Validar que las horas no excedan el total de la tarea padre
    db.get('SELECT horas FROM tasks WHERE id = ? AND parent_id IS NULL', [parentId], (err, parentTask) => {
        if (err) {
            console.error('❌ Error obteniendo tarea padre:', err);
            return res.status(500).json({ error: err.message });
        }
        
        if (!parentTask) {
            return res.status(404).json({ error: 'Tarea padre no encontrada' });
        }
        
        const parentHours = parentTask.horas || 0;
        
        // Obtener suma de subtareas existentes
        db.get('SELECT COALESCE(SUM(horas), 0) as totalSubtasks FROM tasks WHERE parent_id = ?', [parentId], (err, result) => {
            if (err) {
                console.error('❌ Error sumando subtareas existentes:', err);
                return res.status(500).json({ error: err.message });
            }
            
            const currentSubtaskHours = result.totalSubtasks || 0;
            const totalAfterNew = currentSubtaskHours + newHours;
            
            console.log(`🔍 Validación: Padre=${parentHours}h, Subtareas actuales=${currentSubtaskHours}h, Nueva=${newHours}h, Total=${totalAfterNew}h`);
            
            if (totalAfterNew > parentHours) {
                const available = parentHours - currentSubtaskHours;
                return res.status(400).json({ 
                    error: `Las horas exceden el total de la tarea padre. Disponible: ${available.toFixed(2)}h de ${parentHours}h total`,
                    available: available,
                    parentHours: parentHours,
                    currentSubtasks: currentSubtaskHours,
                    requested: newHours
                });
            }
            
            // Si la validación pasa, crear la subtarea
            db.run(
                'INSERT INTO tasks (tarea, horas, observaciones, recurso, parent_id, is_subtask, sort_order) VALUES (?, ?, ?, ?, ?, 1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tasks WHERE parent_id = ?))',
                [tarea, newHours, observaciones || '', '', parentId, parentId],
                function(err) {
                    if (err) {
                        console.error('❌ Error creando subtarea:', err);
                        res.status(500).json({ error: err.message });
                        return;
                    }
                    console.log(`✅ Subtarea creada con ID: ${this.lastID} (${newHours}h de ${parentHours}h total)`);
                    invalidateStatsCache(); // Invalidar cache al crear subtarea
                    res.json({ 
                        id: this.lastID, 
                        message: 'Subtarea creada exitosamente',
                        hoursUsed: totalAfterNew,
                        hoursTotal: parentHours,
                        hoursRemaining: parentHours - totalAfterNew
                    });
                }
            );
        });
    });
});

// Reordenar tareas (debe ir antes de PUT /api/tasks/:id)
app.put('/api/tasks/reorder', (req, res) => {
    const { order } = req.body;
    
    if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'Se requiere un array de IDs' });
    }
    
    console.log('🔄 Reordenando tareas:', order);
    
    // Actualizar sort_order para cada tarea
    const updatePromises = order.map((taskId, index) => {
        return new Promise((resolve, reject) => {
            db.run(
                'UPDATE tasks SET sort_order = ? WHERE id = ?',
                [index, taskId],
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    });
    
    Promise.all(updatePromises)
        .then(() => {
            console.log('✅ Orden de tareas actualizado');
            invalidateStatsCache(); // Invalidar cache por si cambian estadísticas
            res.json({ message: 'Orden actualizado exitosamente' });
        })
        .catch(err => {
            console.error('❌ Error reordenando tareas:', err);
            res.status(500).json({ error: err.message });
        });
});

app.put('/api/tasks/:id', (req, res) => {
    const { tarea, horas, observaciones, recurso, status } = req.body;
    const { id } = req.params;
    const newHours = parseFloat(horas) || 0;

    console.log(`📝 Actualizando tarea ID: ${id}`);

    db.get('SELECT COALESCE(SUM(horas), 0) as subtask_total FROM tasks WHERE parent_id = ?', [id], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        const subtaskTotal = result.subtask_total || 0;
        if (subtaskTotal > 0 && newHours < subtaskTotal) {
            return res.status(400).json({
                error: `Las horas no pueden ser menores que la suma de subtareas (${subtaskTotal.toFixed(2)}h)`
            });
        }

        db.run(
            'UPDATE tasks SET tarea = ?, horas = ?, observaciones = ?, recurso = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [tarea, newHours, observaciones || '', recurso || '', status || 'pending', id],
            function(err) {
                if (err) {
                    console.error('❌ Error actualizando tarea:', err);
                    res.status(500).json({ error: err.message });
                    return;
                }
                console.log(`✅ Tarea ${id} actualizada`);
                invalidateStatsCache();
                res.json({ message: 'Tarea actualizada exitosamente' });
            }
        );
    });
});

// Eliminar todas las tareas
app.delete('/api/tasks', (req, res) => {
    console.log('🗑️ Eliminando todas las tareas');

    db.run('DELETE FROM tasks', function(err) {
        if (err) {
            console.error('❌ Error eliminando todas las tareas:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        console.log(`✅ ${this.changes} tareas eliminadas`);
        invalidateStatsCache(); // Invalidar cache al eliminar todas las tareas
        res.json({ message: `${this.changes} tareas eliminadas exitosamente` });
    });
});

app.delete('/api/tasks/:id', (req, res) => {
    const { id } = req.params;

    console.log(`🗑️ Eliminando tarea ID: ${id}`);

    db.run('DELETE FROM tasks WHERE parent_id = ?', [id], function(err) {
        if (err) {
            console.error('❌ Error eliminando subtareas:', err);
            return res.status(500).json({ error: err.message });
        }
        db.run('DELETE FROM tasks WHERE id = ?', [id], function(err) {
            if (err) {
                console.error('❌ Error eliminando tarea:', err);
                return res.status(500).json({ error: err.message });
            }
            console.log(`✅ Tarea ${id} y sus subtareas eliminadas`);
            invalidateStatsCache();
            res.json({ message: 'Tarea eliminada exitosamente' });
        });
    });
});

// Validar suma de subtareas
app.get('/api/tasks/:id/validate', (req, res) => {
    const { id } = req.params;
    
    // Obtener la tarea principal
    db.get('SELECT * FROM tasks WHERE id = ? AND is_subtask = 0', [id], (err, parentTask) => {
        if (err) {
            console.error('❌ Error obteniendo tarea principal:', err);
            return res.status(500).json({ error: err.message });
        }
        
        if (!parentTask) {
            return res.status(404).json({ error: 'Tarea no encontrada' });
        }
        
        // Obtener suma de subtareas
        db.get('SELECT SUM(horas) as total_subtasks FROM tasks WHERE parent_id = ?', [id], (err, result) => {
            if (err) {
                console.error('❌ Error sumando subtareas:', err);
                return res.status(500).json({ error: err.message });
            }
            
            const totalSubtasks = result.total_subtasks || 0;
            const parentHours = parentTask.horas || 0;
            const isValid = Math.abs(totalSubtasks - parentHours) < 0.01; // Tolerancia de 0.01 horas
            
            res.json({
                parentHours: parentHours,
                totalSubtasks: totalSubtasks,
                difference: totalSubtasks - parentHours,
                isValid: isValid,
                message: isValid ? 'Las horas coinciden' : `Diferencia de ${(totalSubtasks - parentHours).toFixed(2)} horas`
            });
        });
    });
});

// Reordenar tareas con drag & drop
app.post('/api/tasks/reorder', (req, res) => {
    const { taskId, targetTaskId } = req.body;
    
    if (!taskId || !targetTaskId) {
        return res.status(400).json({ error: 'Se requiere taskId y targetTaskId' });
    }
    
    console.log(`🔄 Drag & Drop: Moviendo tarea ${taskId} a posición de tarea ${targetTaskId}`);
    
    // Obtener todas las tareas ordenadas para hacer un reordenamiento completo
    db.all('SELECT id, sort_order FROM tasks WHERE parent_id IS NULL ORDER BY sort_order ASC, id ASC', (err, tasks) => {
        if (err) {
            console.error('❌ Error obteniendo tareas:', err);
            return res.status(500).json({ error: err.message });
        }
        
        // Encontrar las posiciones de las tareas
        const draggedIndex = tasks.findIndex(t => t.id == taskId);
        const targetIndex = tasks.findIndex(t => t.id == targetTaskId);
        
        if (draggedIndex === -1 || targetIndex === -1) {
            return res.status(404).json({ error: 'Tarea no encontrada' });
        }
        
        // Reordenar el array: remover la tarea arrastrada e insertarla en la posición objetivo
        const reorderedTasks = [...tasks];
        const draggedTask = reorderedTasks.splice(draggedIndex, 1)[0];
        reorderedTasks.splice(targetIndex, 0, draggedTask);
        
        // Actualizar sort_order para todas las tareas con el nuevo orden
        const updatePromises = reorderedTasks.map((task, index) => {
            return new Promise((resolve, reject) => {
                db.run('UPDATE tasks SET sort_order = ? WHERE id = ?', [index, task.id], function(err) {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
        
        Promise.all(updatePromises)
            .then(() => {
                console.log(`✅ Tarea ${taskId} reordenada exitosamente mediante drag & drop`);
                invalidateStatsCache();
                res.json({ 
                    message: 'Tarea reordenada exitosamente',
                    taskId: taskId,
                    newPosition: targetIndex
                });
            })
            .catch(err => {
                console.error('❌ Error actualizando orden:', err);
                res.status(500).json({ error: err.message });
            });
    });
});

// Exportar a Excel
app.post('/api/export', async (req, res) => {
    try {
        const { title, filename } = req.body;
        console.log('📊 Generando reporte Excel:', { title, filename });

        const allRows = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM tasks ORDER BY CASE WHEN parent_id IS NULL THEN sort_order ELSE parent_id END, parent_id IS NULL DESC, sort_order ASC', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Construir jerarquía
        const taskMap = {};
        const parents = [];
        allRows.forEach(r => { r.subtasks = []; taskMap[r.id] = r; });
        allRows.forEach(r => {
            if (r.parent_id) { if (taskMap[r.parent_id]) taskMap[r.parent_id].subtasks.push(r); }
            else parents.push(r);
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

        // Título
        worksheet.insertRow(1, [title || 'Reporte QuickPlan']);
        worksheet.mergeCells('A1:G1');
        const titleCell = worksheet.getCell('A1');
        titleCell.font = { size: 18, bold: true, color: { argb: 'FF2196F3' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } };

        // Fecha
        worksheet.insertRow(2, [`Generado el: ${new Date().toLocaleDateString('es-ES')} a las ${new Date().toLocaleTimeString('es-ES')}`]);
        worksheet.mergeCells('A2:G2');
        const dateCell = worksheet.getCell('A2');
        dateCell.alignment = { horizontal: 'center' };
        dateCell.font = { size: 11, italic: true };

        // Resumen
        const totalHoras = parents.reduce((sum, t) => sum + (parseFloat(t.horas) || 0), 0);
        const totalSubtareas = allRows.filter(r => r.parent_id).length;
        worksheet.insertRow(3, [`Tareas: ${parents.length} | Subtareas: ${totalSubtareas} | Horas totales: ${totalHoras} | andyjara-dev`]);
        worksheet.mergeCells('A3:G3');
        const summaryCell = worksheet.getCell('A3');
        summaryCell.alignment = { horizontal: 'center' };
        summaryCell.font = { size: 10, bold: true };

        worksheet.insertRow(4, []);

        // Filas de datos
        parents.forEach(task => {
            worksheet.addRow({
                id: task.id,
                tarea: task.tarea,
                status: statusLabel[task.status] || 'Pendiente',
                horas: parseFloat(task.horas) || 0,
                observaciones: task.observaciones || '',
                recurso: task.recurso || '',
                created_at: new Date(task.created_at).toLocaleDateString('es-ES')
            });
            task.subtasks.forEach(sub => {
                worksheet.addRow({
                    id: sub.id,
                    tarea: '    ↳ ' + sub.tarea,
                    status: statusLabel[sub.status] || 'Pendiente',
                    horas: parseFloat(sub.horas) || 0,
                    observaciones: sub.observaciones || '',
                    recurso: sub.recurso || task.recurso || '',
                    created_at: new Date(sub.created_at).toLocaleDateString('es-ES')
                });
            });
        });

        // Estilo encabezado
        const headerRow = worksheet.getRow(5);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1976D2' } };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

        // Estilo filas de datos
        let rowIdx = 6;
        let even = false;
        parents.forEach(task => {
            const r = worksheet.getRow(rowIdx);
            r.font = { size: 9 };
            r.height = 28;
            if (even) r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8F9FA' } };
            worksheet.getCell(`E${rowIdx}`).alignment = { wrapText: true, vertical: 'top' };
            rowIdx++;
            even = !even;

            task.subtasks.forEach(() => {
                const sr = worksheet.getRow(rowIdx);
                sr.font = { size: 9, italic: true };
                sr.height = 22;
                sr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
                worksheet.getCell(`E${rowIdx}`).alignment = { wrapText: true, vertical: 'top' };
                rowIdx++;
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        console.log(`✅ Excel generado: ${buffer.length} bytes`);

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

// Cache simple para estadísticas (evitar consultas repetitivas)
let statsCache = null;
let statsCacheTime = 0;
const STATS_CACHE_TTL = 30000; // 30 segundos

// Función para invalidar cache de estadísticas
function invalidateStatsCache() {
    statsCache = null;
    statsCacheTime = 0;
    console.log('🔄 Cache de estadísticas invalidado');
}

// Endpoint para estadísticas con cache
app.get('/api/stats', (req, res) => {
    console.log('📊 Solicitando estadísticas');
    
    // Usar cache si está vigente
    const now = Date.now();
    if (statsCache && (now - statsCacheTime) < STATS_CACHE_TTL) {
        console.log('📈 Usando estadísticas en cache');
        return res.json(statsCache);
    }
    
    // Consultar DB solo si no hay cache válido
    db.all(`
        SELECT 
            COUNT(CASE WHEN is_subtask = 0 THEN 1 END) as total_tareas,
            SUM(CASE WHEN is_subtask = 0 THEN horas ELSE 0 END) as total_horas,
            COUNT(DISTINCT recurso) as recursos_unicos,
            AVG(CASE WHEN is_subtask = 0 THEN horas END) as promedio_horas
        FROM tasks
    `, (err, stats) => {
        if (err) {
            console.error('❌ Error consultando estadísticas:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        
        // Actualizar cache
        statsCache = stats[0];
        statsCacheTime = now;
        
        console.log('✅ Estadísticas actualizadas y cacheadas');
        res.json(statsCache);
    });
});

// Manejar rutas no encontradas (SPA routing)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('⚡ QuickPlan - Sistema de Gestión de Tareas');
    console.log('==========================================');
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
    console.log(`🌐 URL local: http://localhost:${PORT}`);
    console.log(`🌐 URL externa: http://0.0.0.0:${PORT}`);
    console.log(`📅 Iniciado: ${new Date().toLocaleString('es-ES')}`);
    console.log(`💾 Base de datos: ${dbPath}`);
    console.log(`👨‍💻 Desarrollado por: andyjara-dev`);
    console.log('==========================================');
});

// Manejo de cierre graceful
process.on('SIGINT', () => {
    console.log('\n🛑 Cerrando QuickPlan gracefully...');
    db.close((err) => {
        if (err) {
            console.error('❌ Error cerrando base de datos:', err);
        } else {
            console.log('✅ Base de datos cerrada correctamente');
        }
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('🛑 Señal SIGTERM recibida, cerrando QuickPlan...');
    db.close();
    process.exit(0);
});