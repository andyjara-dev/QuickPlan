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

// Crear directorio data si no existe
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Configuración de seguridad
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.quasar.dev", "https://fonts.googleapis.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com", "https://cdn.quasar.dev"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.quasar.dev"],
            connectSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"]
        }
    }
}));

// Middleware
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // máximo 100 requests por IP
    message: { error: 'Demasiadas solicitudes, intenta en 15 minutos' }
});
app.use('/api/', limiter);

// Inicializar base de datos
const dbPath = path.join(dataDir, 'tasks.db');
console.log('📁 Base de datos en:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Error conectando a la base de datos:', err);
    } else {
        console.log('✅ Conectado a la base de datos SQLite');
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) {
        console.error('❌ Error creando tabla:', err);
    } else {
        console.log('✅ Tabla de tareas lista');
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

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'QuickPlan',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// API Routes
app.get('/api/tasks', (req, res) => {
    console.log('📋 Consultando todas las tareas');
    db.all('SELECT * FROM tasks ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            console.error('❌ Error consultando tareas:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        console.log(`✅ ${rows.length} tareas encontradas`);
        res.json(rows);
    });
});

app.post('/api/tasks', (req, res) => {
    const { tarea, horas, observaciones, recurso } = req.body;
    
    console.log('➕ Creando nueva tarea:', { tarea, horas, recurso });
    
    if (!tarea || !recurso) {
        return res.status(400).json({ error: 'Tarea y recurso son requeridos' });
    }

    db.run(
        'INSERT INTO tasks (tarea, horas, observaciones, recurso) VALUES (?, ?, ?, ?)',
        [tarea, parseFloat(horas) || 0, observaciones || '', recurso],
        function(err) {
            if (err) {
                console.error('❌ Error creando tarea:', err);
                res.status(500).json({ error: err.message });
                return;
            }
            console.log(`✅ Tarea creada con ID: ${this.lastID}`);
            res.json({ id: this.lastID, message: 'Tarea creada exitosamente' });
        }
    );
});

app.put('/api/tasks/:id', (req, res) => {
    const { tarea, horas, observaciones, recurso } = req.body;
    const { id } = req.params;

    console.log(`📝 Actualizando tarea ID: ${id}`);

    db.run(
        'UPDATE tasks SET tarea = ?, horas = ?, observaciones = ?, recurso = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [tarea, parseFloat(horas) || 0, observaciones || '', recurso, id],
        function(err) {
            if (err) {
                console.error('❌ Error actualizando tarea:', err);
                res.status(500).json({ error: err.message });
                return;
            }
            console.log(`✅ Tarea ${id} actualizada`);
            res.json({ message: 'Tarea actualizada exitosamente' });
        }
    );
});

app.delete('/api/tasks/:id', (req, res) => {
    const { id } = req.params;

    console.log(`🗑️ Eliminando tarea ID: ${id}`);

    db.run('DELETE FROM tasks WHERE id = ?', [id], function(err) {
        if (err) {
            console.error('❌ Error eliminando tarea:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        console.log(`✅ Tarea ${id} eliminada`);
        res.json({ message: 'Tarea eliminada exitosamente' });
    });
});

// Exportar a Excel
app.post('/api/export', async (req, res) => {
    try {
        const { title, filename } = req.body;
        
        console.log('📊 Generando reporte Excel:', { title, filename });
        
        // Obtener todas las tareas
        const tasks = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM tasks ORDER BY created_at DESC', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        // Crear workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Tareas QuickPlan');

        // Metadatos del archivo
        workbook.creator = 'QuickPlan by andyjara-dev';
        workbook.lastModifiedBy = 'QuickPlan';
        workbook.created = new Date();
        workbook.modified = new Date();

        // Configurar columnas
        worksheet.columns = [
            { header: 'ID', key: 'id', width: 8 },
            { header: 'Tarea', key: 'tarea', width: 45 },
            { header: 'Horas', key: 'horas', width: 12 },
            { header: 'Observaciones', key: 'observaciones', width: 35 },
            { header: 'Recurso', key: 'recurso', width: 20 },
            { header: 'Fecha Creación', key: 'created_at', width: 18 }
        ];

        // Título principal
        worksheet.insertRow(1, [title || 'Reporte QuickPlan']);
        worksheet.mergeCells('A1:F1');
        const titleCell = worksheet.getCell('A1');
        titleCell.font = { size: 18, bold: true, color: { argb: 'FF2196F3' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        titleCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE3F2FD' }
        };

        // Información del reporte
        worksheet.insertRow(2, [`Generado el: ${new Date().toLocaleDateString('es-ES')} a las ${new Date().toLocaleTimeString('es-ES')}`]);
        worksheet.mergeCells('A2:F2');
        const dateCell = worksheet.getCell('A2');
        dateCell.alignment = { horizontal: 'center' };
        dateCell.font = { size: 11, italic: true };

        // Resumen
        const totalHoras = tasks.reduce((sum, task) => sum + (parseFloat(task.horas) || 0), 0);
        const totalTareas = tasks.length;
        worksheet.insertRow(3, [`Total de tareas: ${totalTareas} | Horas totales: ${totalHoras} | Por: andyjara-dev`]);
        worksheet.mergeCells('A3:F3');
        const summaryCell = worksheet.getCell('A3');
        summaryCell.alignment = { horizontal: 'center' };
        summaryCell.font = { size: 10, bold: true };

        // Espacio
        worksheet.insertRow(4, []);

        // Agregar datos
        tasks.forEach(task => {
            worksheet.addRow({
                id: task.id,
                tarea: task.tarea,
                horas: parseFloat(task.horas) || 0,
                observaciones: task.observaciones || '',
                recurso: task.recurso || '',
                created_at: new Date(task.created_at).toLocaleDateString('es-ES')
            });
        });

        // Estilo para encabezados de datos
        const headerRow = worksheet.getRow(5);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1976D2' }
        };
        headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

        // Bordes para todas las celdas con datos
        const dataRange = `A5:F${5 + tasks.length}`;
        worksheet.getCell(dataRange).border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        };

        // Alternar colores de filas
        for (let i = 6; i <= 5 + tasks.length; i++) {
            if (i % 2 === 0) {
                worksheet.getRow(i).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFF8F9FA' }
                };
            }
        }

        // Generar buffer
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

// Endpoint para estadísticas
app.get('/api/stats', (req, res) => {
    db.all(`
        SELECT 
            COUNT(*) as total_tareas,
            SUM(horas) as total_horas,
            COUNT(DISTINCT recurso) as recursos_unicos,
            AVG(horas) as promedio_horas
        FROM tasks
    `, (err, stats) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(stats[0]);
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