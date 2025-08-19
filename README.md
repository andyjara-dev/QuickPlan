# ⚡ QuickPlan

<div align="center">

![QuickPlan Logo](https://img.shields.io/badge/QuickPlan-v1.0.0-blue?style=for-the-badge&logo=lightning)
![Docker](https://img.shields.io/badge/Docker-Compatible-2496ED?style=for-the-badge&logo=docker)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js)
![Vue.js](https://img.shields.io/badge/Vue.js-3-4FC08D?style=for-the-badge&logo=vue.js)

**Sistema de gestión de tareas rápido y eficiente con exportación a Excel**

[🚀 Demo en Vivo](#) • [📖 Documentación](#documentación) • [🐛 Reportar Bug](https://github.com/andyjara-dev/QuickPlan/issues)

</div>

## 🎯 Características Principales

- ✅ **Gestión Intuitiva** - Interfaz moderna y responsiva con Vue.js 3
- ⚡ **Edición en Tiempo Real** - Modifica tareas directamente en la grilla (click para editar)
- 📊 **Exportación Excel** - Reportes profesionales personalizables con un click
- 🐳 **Docker Ready** - Deployment fácil y escalable en cualquier VPS
- 💾 **Backup Automático** - Protección de datos integrada
- 🔒 **Seguro** - Implementación con mejores prácticas de seguridad
- 📱 **Responsive** - Funciona perfecto en desktop, tablet y móvil

## 🖼️ Estructura de Datos

### ✨ Campos de Tareas
- 📝 **Tarea** - Descripción de la actividad (requerido)
- ⏱️ **Horas** - Tiempo aproximado en formato decimal (ej: 4.5)
- 📋 **Observaciones** - Notas adicionales o comentarios
- 👤 **Recurso** - Persona a cargo de la tarea (requerido)

### 🔥 Funcionalidades Implementadas
- ✅ **CRUD completo** - Crear, leer, actualizar y eliminar tareas
- ✅ **Grilla editable** - Click en cualquier celda para editar in-place
- ✅ **Exportación Excel** - Reportes profesionales con metadatos
- ✅ **Estadísticas en vivo** - Total tareas, horas, recursos únicos y promedios
- ✅ **Validaciones** - Campos requeridos y tipos de datos
- ✅ **Notificaciones** - Feedback visual para todas las acciones
- ✅ **Interfaz moderna** - Diseño profesional con Quasar Framework

## 🚀 Inicio Rápido

### Opción 1: Deployment en VPS (Recomendado)

```bash
# 1. Clonar el repositorio
git clone https://github.com/andyjara-dev/QuickPlan.git
cd QuickPlan

# 2. Hacer ejecutables los scripts
chmod +x *.sh

# 3. Desplegar con un comando
./deploy-vps.sh

# 4. Acceder a la aplicación
# http://tu-ip-publica
```

### Opción 2: Desarrollo Local (Node.js)

```bash
# 1. Instalar dependencias
npm install

# 2. Iniciar servidor de desarrollo
npm start

# 3. Abrir navegador
http://localhost:3000
```

### Opción 3: Docker Compose Local

```bash
# 1. Construir y ejecutar
docker compose up -d

# 2. Verificar servicios
docker compose ps

# 3. Acceder a la aplicación
http://localhost
```

### Opción 4: Desarrollo Windows (PowerShell)

```powershell
# 1. Navegar al directorio
cd "C:\ruta\a\QuickPlan"

# 2. Instalar dependencias
npm install

# 3. Ejecutar servidor
npm start

# 4. Abrir http://localhost:3000
```

## 🛠️ Tecnologías Utilizadas

| Categoría | Tecnología | Versión | Propósito |
|-----------|------------|---------|-----------|
| **Frontend** | Vue.js | 3.x | Framework reactivo |
| **UI Framework** | Quasar | 2.x | Componentes y diseño |
| **Backend** | Node.js | 18+ | Servidor de aplicación |
| **Web Framework** | Express.js | 4.x | API REST |
| **Base de Datos** | SQLite | 3.x | Almacenamiento de datos |
| **Containerización** | Docker | Latest | Contenedores |
| **Orchestration** | Docker Compose | Latest | Multi-contenedor |
| **Proxy** | Nginx | Latest | Proxy reverso |
| **Seguridad** | Helmet | 7.x | Headers de seguridad |
| **Excel Export** | ExcelJS | 4.x | Generación de reportes |

## 📖 Documentación

### Comandos de Administración

```bash
# 🚀 Gestión de servicios
./admin-quickplan.sh start     # Iniciar QuickPlan
./admin-quickplan.sh stop      # Detener servicios
./admin-quickplan.sh restart   # Reiniciar sistema
./admin-quickplan.sh status    # Estado de servicios

# 📊 Monitoreo y logs
./admin-quickplan.sh logs      # Ver logs en tiempo real
./admin-quickplan.sh logs-app  # Logs solo de la aplicación
./admin-quickplan.sh health    # Verificar health checks
./admin-quickplan.sh stats     # Estadísticas de recursos

# 🔧 Mantenimiento
./admin-quickplan.sh backup    # Backup manual de BD
./admin-quickplan.sh restore   # Restaurar desde backup
./admin-quickplan.sh update    # Actualizar desde Git
./admin-quickplan.sh clean     # Limpiar recursos Docker

# 🔍 Información
./admin-quickplan.sh info      # Información del sistema
./admin-quickplan.sh urls      # URLs de acceso
./admin-quickplan.sh help      # Ayuda completa
```

### Scripts de Configuración

```bash
# Preparar estructura inicial
./preparar-quickplan.sh

# Crear directorios completos
./crear-estructura.sh

# Subir a GitHub
./upload-to-github.sh

# Deployment completo en VPS
./deploy-vps.sh
```

### Variables de Entorno

| Variable | Descripción | Valor por Defecto |
|----------|-------------|-------------------|
| `NODE_ENV` | Ambiente de ejecución | `production` |
| `PORT` | Puerto de la aplicación | `3000` |
| `TZ` | Zona horaria | `America/Santiago` |

### API Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/health` | Health check del sistema |
| `GET` | `/api/tasks` | Obtener todas las tareas |
| `POST` | `/api/tasks` | Crear nueva tarea |
| `PUT` | `/api/tasks/:id` | Actualizar tarea |
| `DELETE` | `/api/tasks/:id` | Eliminar tarea |
| `GET` | `/api/stats` | Estadísticas del sistema |
| `POST` | `/api/export` | Generar reporte Excel |

## 🔧 Configuración Avanzada

### SSL/HTTPS

```bash
# Colocar certificados en nginx/ssl/
nginx/ssl/
├── certificate.crt
├── private.key
└── .gitkeep
```

### Backup Personalizado

```bash
# Backup manual
./admin-quickplan.sh backup

# Backup con retención personalizada (en docker-compose.yml)
RETENTION_DAYS=30 docker compose run --rm quickplan-backup
```

### Configuración de Desarrollo

```bash
# Instalar dependencias de desarrollo
npm install --include=dev

# Ejecutar en modo desarrollo con nodemon
npm run dev

# Ejecutar tests (cuando estén implementados)
npm test
```

## 🏗️ Estructura del Proyecto

```
QuickPlan/
├── 📁 public/           # Archivos estáticos (HTML, CSS, JS)
│   └── index.html       # Aplicación Vue.js principal
├── 📁 data/             # Base de datos SQLite
│   ├── tasks.db         # BD principal (auto-creada)
│   └── .gitkeep         # Mantener directorio en Git
├── 📁 backups/          # Backups automáticos
│   └── .gitkeep
├── 📁 logs/             # Logs de aplicación
│   └── .gitkeep
├── 📁 nginx/            # Configuración Nginx
│   ├── nginx.conf       # Config del proxy
│   └── ssl/             # Certificados SSL
├── 📄 server.js         # Servidor Node.js principal
├── 📄 package.json      # Dependencias y scripts
├── 📄 Dockerfile        # Imagen Docker de la app
├── 📄 docker-compose.yml # Orquestación de servicios
├── 🔧 deploy-vps.sh     # Script de deployment
├── 🔧 admin-quickplan.sh # Script de administración
├── 🔧 preparar-quickplan.sh # Setup inicial
├── 🔧 crear-estructura.sh # Crear directorios
├── 🔧 upload-to-github.sh # Subir a GitHub
└── 📖 README.md         # Esta documentación
```

## 🤝 Contribuir

¡Las contribuciones son bienvenidas! Sigue estos pasos:

1. **Fork** el proyecto
2. **Crea** una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. **Commit** tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. **Push** a la rama (`git push origin feature/AmazingFeature`)
5. **Abre** un Pull Request

### Guías de Contribución

- Usa commits descriptivos con emojis
- Mantén el código limpio y comentado
- Actualiza la documentación si es necesario
- Prueba localmente antes de hacer PR

## 📝 Roadmap

### Versión 1.1 (Próxima)
- [ ] Sistema de autenticación de usuarios
- [ ] Categorías de tareas
- [ ] Filtros y búsqueda avanzada
- [ ] Modo oscuro

### Versión 1.2 (Futuro)
- [ ] Notificaciones en tiempo real
- [ ] Integración con calendarios
- [ ] API REST completa con documentación
- [ ] PWA (Progressive Web App)

### Versión 2.0 (Visión)
- [ ] Multi-tenancy
- [ ] Dashboard avanzado con gráficos
- [ ] Integración con herramientas de PM
- [ ] App móvil nativa

## 🐛 Reportar Problemas

¿Encontraste un bug? [Abre un issue](https://github.com/andyjara-dev/QuickPlan/issues/new) con:

- **Descripción** clara del problema
- **Pasos** para reproducir
- **Comportamiento esperado** vs actual
- **Screenshots** (si aplica)
- **Información del sistema** (OS, navegador, versión)

## � Uso en Producción

### Requisitos Mínimos VPS
- **CPU**: 1 vCore
- **RAM**: 512 MB
- **Disco**: 2 GB
- **SO**: Ubuntu 20.04+ / CentOS 8+ / Debian 10+
- **Software**: Docker + Docker Compose

### Optimizaciones Recomendadas
- Usar proxy reverso (Nginx incluido)
- Configurar certificados SSL
- Implementar backups automáticos
- Monitorear recursos del sistema
- Configurar firewall básico

## �👨‍💻 Autor

**andyjara-dev**
- 🐙 GitHub: [@andyjara-dev](https://github.com/andyjara-dev)
- 💼 LinkedIn: [Perfil profesional](#)
- 📧 Email: andyjara.dev@gmail.com
- 🌐 Portfolio: [andyjara.dev](#)

## 📄 Licencia

Este proyecto está bajo la **Licencia MIT** - ver el archivo [LICENSE](LICENSE) para más detalles.

### ¿Qué significa?
- ✅ Uso comercial permitido
- ✅ Modificación permitida
- ✅ Distribución permitida
- ✅ Uso privado permitido
- ❌ Sin garantía
- ❌ Sin responsabilidad del autor

## 🙏 Agradecimientos

- [Vue.js](https://vuejs.org/) por el excelente framework frontend
- [Quasar](https://quasar.dev/) por los componentes UI profesionales
- [ExcelJS](https://github.com/exceljs/exceljs) por la potente exportación Excel
- [Express.js](https://expressjs.com/) por el framework web minimalista
- [SQLite](https://www.sqlite.org/) por la base de datos embebida
- [Docker](https://www.docker.com/) por la containerización
- [Nginx](https://nginx.org/) por el proxy reverso eficiente

## 📈 Estadísticas

![GitHub stars](https://img.shields.io/github/stars/andyjara-dev/QuickPlan?style=social)
![GitHub forks](https://img.shields.io/github/forks/andyjara-dev/QuickPlan?style=social)
![GitHub watchers](https://img.shields.io/github/watchers/andyjara-dev/QuickPlan?style=social)

![GitHub last commit](https://img.shields.io/github/last-commit/andyjara-dev/QuickPlan)
![GitHub issues](https://img.shields.io/github/issues/andyjara-dev/QuickPlan)
![GitHub pull requests](https://img.shields.io/github/issues-pr/andyjara-dev/QuickPlan)

---

<div align="center">

**⭐ Si QuickPlan te ayuda, dale una estrella en GitHub ⭐**

**¡Gracias por usar QuickPlan! 🚀**

---

*Desarrollado con ❤️ por andyjara-dev*

</div>