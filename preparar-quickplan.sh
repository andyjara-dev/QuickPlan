#!/bin/bash

# =============================================================================
# 📦 QuickPlan Setup Script
# =============================================================================
# Autor: andyjara-dev
# Descripción: Script para preparar estructura inicial de QuickPlan
# =============================================================================

set -e

echo "⚡ Preparando estructura de QuickPlan..."

# Crear directorios necesarios
echo "📁 Creando directorios..."
mkdir -p {public,nginx,data,backups,nginx/ssl,logs}

# Crear archivos placeholder para directorios vacíos
echo "📝 Creando archivos .gitkeep..."
touch data/.gitkeep
touch backups/.gitkeep
touch nginx/ssl/.gitkeep
touch logs/.gitkeep

# Configurar permisos
echo "🔐 Configurando permisos..."
chmod 755 data/ backups/ logs/ nginx/
chmod 644 data/.gitkeep backups/.gitkeep nginx/ssl/.gitkeep logs/.gitkeep

# Inicializar Git si no existe
if [ ! -d ".git" ]; then
    echo "🔄 Inicializando repositorio Git..."
    git init
    git branch -M main
else
    echo "ℹ️ Repositorio Git ya existe"
fi

echo "✅ Estructura de QuickPlan preparada exitosamente!"
echo ""
echo "📋 Estructura creada:"
echo "   • data/          (Base de datos SQLite)"
echo "   • backups/       (Backups automáticos)"
echo "   • logs/          (Logs de la aplicación)"
echo "   • nginx/ssl/     (Certificados SSL)"
echo "   • public/        (Archivos estáticos)"
echo ""
echo "🚀 Siguiente paso: npm install && npm start"