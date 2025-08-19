#!/bin/bash

# =============================================================================
# 🏗️ QuickPlan Directory Structure Creator
# =============================================================================
# Autor: andyjara-dev
# Descripción: Crear estructura completa de directorios para QuickPlan
# =============================================================================

set -e

echo "🏗️ Creando estructura completa de QuickPlan..."

# Crear todos los directorios necesarios
echo "📁 Creando directorios del sistema..."
mkdir -p {public,nginx,data,backups,logs,nginx/ssl,.vscode}

# Crear archivos placeholder para Git
echo "📝 Creando archivos .gitkeep..."
touch data/.gitkeep
touch backups/.gitkeep
touch nginx/ssl/.gitkeep
touch logs/.gitkeep

# Crear archivo .gitignore si no existe
if [ ! -f ".gitignore" ]; then
    echo "📄 Creando .gitignore..."
    cat > .gitignore << 'EOF'
# Dependencias
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Base de datos
data/*.db
data/*.db-journal
data/*.db-wal
data/*.db-shm

# Logs
logs/*.log
*.log

# SSL Certificates (mantener solo .gitkeep)
nginx/ssl/*.crt
nginx/ssl/*.key
nginx/ssl/*.pem
!nginx/ssl/.gitkeep

# Backups (mantener solo .gitkeep)
backups/*.db
backups/*.sql
backups/*.tar.gz
!backups/.gitkeep

# Environment
.env
.env.local
.env.production

# Sistema
.DS_Store
Thumbs.db
*.swp
*.swo

# IDE
.vscode/settings.json
.idea/
*.code-workspace

# Docker
.docker/
EOF
    echo "✅ .gitignore creado"
fi

# Configurar permisos
echo "🔐 Configurando permisos..."
chmod 755 data/ backups/ logs/ nginx/ public/
chmod 644 .gitignore 2>/dev/null || true

echo "✅ Estructura completa creada exitosamente!"
echo ""
echo "📋 Directorios creados:"
echo "   ├── data/          # Base de datos SQLite"
echo "   ├── backups/       # Backups automáticos"
echo "   ├── logs/          # Logs de aplicación"
echo "   ├── nginx/         # Configuración proxy"
echo "   │   └── ssl/       # Certificados SSL"
echo "   ├── public/        # Archivos estáticos"
echo "   └── .vscode/       # Configuración VS Code"
echo ""
echo "📄 Archivos creados:"
echo "   ├── .gitignore     # Exclusiones de Git"
echo "   └── */".gitkeep"   # Marcadores de directorios"