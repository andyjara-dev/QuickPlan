#!/bin/bash

# =============================================================================
# 📤 QuickPlan GitHub Upload Script
# =============================================================================
# Autor: andyjara-dev
# Descripción: Script para subir QuickPlan a GitHub de manera organizada
# =============================================================================

set -e

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

echo -e "${BLUE}⚡ QuickPlan GitHub Upload${NC}"
echo "=============================================="

# Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ] || [ ! -f "server.js" ]; then
    log_error "No estás en el directorio raíz de QuickPlan"
    exit 1
fi

log_info "Verificando estado del repositorio..."

# Inicializar Git si no existe
if [ ! -d ".git" ]; then
    log_info "Inicializando repositorio Git..."
    git init
    git branch -M main
    log_success "Repositorio Git inicializado"
else
    log_info "Repositorio Git ya existe"
fi

# Configurar Git (si no está configurado)
if [ -z "$(git config --get user.name)" ]; then
    log_info "Configurando usuario Git..."
    git config user.name "andyjara-dev"
    git config user.email "andyjara.dev@gmail.com"
    log_success "Usuario Git configurado"
fi

# Verificar archivos principales
log_info "Verificando archivos del proyecto..."
required_files=("package.json" "server.js" "Dockerfile" "docker-compose.yml" "README.md")
for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        log_success "$file encontrado"
    else
        log_warning "$file no encontrado"
    fi
done

# Crear .gitignore si no existe
if [ ! -f ".gitignore" ]; then
    log_info "Creando .gitignore..."
    ./crear-estructura.sh
fi

# Agregar archivos al staging
log_info "Agregando archivos al staging..."
git add .

# Verificar si hay cambios para commit
if git diff --staged --quiet; then
    log_warning "No hay cambios para commit"
    log_info "Verificando si hay archivos no trackeados..."
    if [ -z "$(git ls-files --others --exclude-standard)" ]; then
        log_info "No hay archivos nuevos para agregar"
        exit 0
    fi
fi

# Hacer commit
log_info "Creando commit..."
commit_message="🚀 QuickPlan v1.0.0 - Sistema de Gestión de Tareas

✨ Características principales:
• Sistema CRUD completo para gestión de tareas
• Grilla editable con interfaz Vue.js moderna
• Exportación profesional a Excel con ExcelJS
• Arquitectura Node.js + Express + SQLite
• Frontend responsivo con Vue 3 + Quasar
• Deployment automatizado con Docker
• Proxy reverso con Nginx
• Backups automáticos de base de datos
• Configuración de seguridad con Helmet

🛠️ Stack tecnológico:
• Frontend: Vue.js 3, Quasar Framework
• Backend: Node.js, Express.js
• Base de datos: SQLite
• Containerización: Docker, Docker Compose
• Proxy: Nginx
• Seguridad: Helmet, Rate Limiting

📋 Estructura de datos:
• Tarea (descripción)
• Horas aproximadas
• Observaciones
• Recurso a cargo

🚀 Deployment:
• Listo para VPS con un comando
• Scripts automatizados incluidos
• Configuración SSL preparada

👨‍💻 Desarrollado por: andyjara-dev
📅 Fecha: $(date '+%Y-%m-%d')
📋 Versión: 1.0.0"

git commit -m "$commit_message"
log_success "Commit creado exitosamente"

# Verificar si el remoto existe
if git remote get-url origin &>/dev/null; then
    log_info "Remoto 'origin' ya configurado"
    log_info "URL actual: $(git remote get-url origin)"
else
    log_info "Configurando remoto de GitHub..."
    git remote add origin https://github.com/andyjara-dev/QuickPlan.git
    log_success "Remoto configurado"
fi

# Push a GitHub
log_info "Subiendo a GitHub..."
if git push -u origin main; then
    log_success "¡QuickPlan subido exitosamente a GitHub!"
else
    log_warning "Error en push, intentando con force..."
    if git push -u origin main --force; then
        log_success "¡Push con force exitoso!"
    else
        log_error "Error subiendo a GitHub"
        log_info "Verifica:"
        log_info "1. Conexión a internet"
        log_info "2. Permisos del repositorio"
        log_info "3. Autenticación de GitHub"
        exit 1
    fi
fi

echo ""
echo -e "${GREEN}=============================================="
echo "🎉 ¡QuickPlan subido exitosamente!"
echo "=============================================="
echo -e "🌐 Repositorio: ${BLUE}https://github.com/andyjara-dev/QuickPlan${NC}"
echo -e "📊 Commits: ${BLUE}$(git rev-list --count HEAD)${NC}"
echo -e "🔧 Último commit: ${BLUE}$(git log -1 --pretty=format:'%h - %s')${NC}"
echo -e "📅 Fecha: ${BLUE}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo ""
echo -e "${YELLOW}🚀 Próximos pasos:"
echo "1. Clonar en tu VPS: git clone https://github.com/andyjara-dev/QuickPlan.git"
echo "2. Ejecutar deployment: ./deploy-vps.sh"
echo "3. Acceder a tu aplicación en el navegador"
echo -e "${NC}"
echo -e "${GREEN}=============================================${NC}"