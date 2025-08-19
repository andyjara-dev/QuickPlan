# ⚡ QuickPlan

<div align="center">

![QuickPlan Logo](https://img.shields.io/badge/QuickPlan-v1.0.0-blue?style=for-the-badge&logo=lightning)
![Docker](https://img.shields.io/badge/Docker-Compatible-2496ED?style=for-the-badge&logo=docker)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js)
![Vue.js](https://img.shields.io/badge/Vue.js-3-4FC08D?style=for-the-badge&logo=vue.js)

**Sistema de gestión de tareas rápido y eficiente con exportación a Excel**

[🚀 Demo en Vivo](http://tu-servidor.com) • [📖 Documentación](https://github.com/andyjara-dev/quickplan-manager/wiki) • [🐛 Reportar Bug](https://github.com/andyjara-dev/quickplan-manager/issues)

</div>

## 🎯 Características Principales

- ✅ **Gestión Intuitiva** - Interfaz moderna y responsiva
- ⚡ **Edición en Tiempo Real** - Modifica tareas directamente en la grilla
- 📊 **Exportación Excel** - Reportes profesionales personalizables
- 🐳 **Docker Ready** - Deployment fácil y escalable
- 💾 **Backup Automático** - Protección de datos integrada
- 🔒 **Seguro** - Implementación con mejores prácticas

## 🖼️ Capturas de Pantalla

<div align="center">

### Interfaz Principal
![Interfaz Principal](https://via.placeholder.com/800x400/667eea/ffffff?text=QuickPlan+Dashboard)

### Grilla Editable
![Grilla Editable](https://via.placeholder.com/800x300/4caf50/ffffff?text=Grilla+Editable)

### Reporte Excel
![Reporte Excel](https://via.placeholder.com/600x400/orange/ffffff?text=Reporte+Excel)

</div>

## 🚀 Inicio Rápido

### Opción 1: Con Docker (Recomendado)

```bash
# Clonar el repositorio
git clone https://github.com/andyjara-dev/quickplan-manager.git
cd quickplan-manager

# Hacer ejecutables los scripts
chmod +x deploy-quickplan.sh admin-quickplan.sh

# Desplegar con un comando
./deploy-quickplan.sh
```

### Opción 2: Instalación Manual

```bash
# Instalar dependencias
npm install

# Ejecutar en desarrollo
npm run dev

# Ejecutar en producción
npm start
```

## 🛠️ Tecnologías Utilizadas

| Categoría | Tecnología |
|-----------|------------|
| **Frontend** | Vue.js 3, Quasar Framework |
| **Backend** | Node.js, Express.js |
| **Base de Datos** | SQLite |
| **Containerización** | Docker, Docker Compose |
| **Proxy** | Nginx |
| **Seguridad** | Helmet, Rate Limiting |

## 📖 Documentación

### Comandos de Administración

```bash
# Gestión de servicios
./admin-quickplan.sh start     # Iniciar QuickPlan
./admin-quickplan.sh stop      # Detener servicios
./admin-quickplan.sh restart   # Reiniciar sistema

# Monitoreo y logs
./admin-quickplan.sh logs      # Ver logs en tiempo real
./admin-quickplan.sh status    # Estado de servicios
./admin-quickplan.sh stats     # Estadísticas de recursos

# Mantenimiento
./admin-quickplan.sh backup    # Backup manual
./admin-quickplan.sh update    # Actualizar desde Git
./admin-quickplan.sh clean     # Limpiar recursos Docker
```

### Variables de Entorno

| Variable | Descripción | Valor por Defecto |
|----------|-------------|-------------------|
| `NODE_ENV` | Ambiente de ejecución | `production` |
| `PORT` | Puerto de la aplicación | `3000` |
| `TZ` | Zona horaria | `America/Santiago` |

## 🔧 Configuración Avanzada

### SSL/HTTPS

```bash
# Colocar certificados en nginx/ssl/
nginx/ssl/
├── certificate.crt
└── private.key
```

### Backup Personalizado

```bash
# Ejecutar backup con retención personalizada
docker-compose run --rm -e RETENTION_DAYS=30 quickplan-backup
```

## 🤝 Contribuir

¡Las contribuciones son bienvenidas! Sigue estos pasos:

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📝 Roadmap

- [ ] Autenticación de usuarios
- [ ] Notificaciones en tiempo real
- [ ] API REST completa
- [ ] Integración con calendarios
- [ ] Modo oscuro
- [ ] PWA (Progressive Web App)

## 🐛 Reportar Problemas

¿Encontraste un bug? [Abre un issue](https://github.com/andyjara-dev/quickplan-manager/issues/new) con:

- Descripción del problema
- Pasos para reproducir
- Comportamiento esperado
- Screenshots (si aplica)

## 👨‍💻 Autor

**andyjara-dev**
- GitHub: [@andyjara-dev](https://github.com/andyjara-dev)
- LinkedIn: [tu-linkedin](https://linkedin.com/in/tu-perfil)
- Email: tu-email@gmail.com

## 📄 Licencia

Este proyecto está bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para más detalles.

## 🙏 Agradecimientos

- [Vue.js](https://vuejs.org/) por el framework frontend
- [Quasar](https://quasar.dev/) por los componentes UI
- [ExcelJS](https://github.com/exceljs/exceljs) por la exportación Excel
- [Docker](https://www.docker.com/) por la containerización

---

<div align="center">

**⭐ Si te gusta QuickPlan, dale una estrella en GitHub ⭐**

![GitHub stars](https://img.shields.io/github/stars/andyjara-dev/quickplan-manager?style=social)
![GitHub forks](https://img.shields.io/github/forks/andyjara-dev/quickplan-manager?style=social)

</div>