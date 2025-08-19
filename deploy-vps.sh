#!/bin/bash

# =============================================================================
# 🚀 QuickPlan VPS Deployment Script
# =============================================================================
# Autor: andyjara-dev
# Fecha: 2025-08-19
# Descripción: Script completo para deployment de QuickPlan en VPS
# =============================================================================

set -e  # Salir si hay errores

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Funciones de logging
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

# Banner de inicio
print_banner() {
    echo -e "${BLUE}"
    echo "============================================================="
    echo "🚀 QuickPlan VPS Deployment"
    echo "============================================================="
    echo "Fecha: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "Usuario: $(whoami)"
    echo "Directorio: $(pwd)"
    echo "Servidor: $(hostname)"
    echo "============================================================="
    echo -e "${NC}"
}

# Verificar dependencias del sistema
check_dependencies() {
    log_info "Verificando dependencias del sistema..."
    
    # Verificar Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker no está instalado"
        log_info "Instala Docker: curl -fsSL https://get.docker.com | sh"
        exit 1
    fi
    log_success "Docker encontrado: $(docker --version)"
    
    # Verificar Docker Compose
    if ! command -v docker compose &> /dev/null; then
        log_error "Docker Compose no está instalado"
        log_info "Instala Docker Compose: sudo curl -L \"https://github.com/docker/compose/releases/latest/download/docker compose-\$(uname -s)-\$(uname -m)\" -o /usr/local/bin/docker compose && sudo chmod +x /usr/local/bin/docker compose"
        exit 1
    fi
    log_success "Docker Compose encontrado: $(docker compose --version)"
    
    # Verificar que Docker está corriendo
    if ! docker info &> /dev/null; then
        log_warning "Docker no está corriendo, intentando iniciar..."
        sudo systemctl start docker || {
            log_error "No se pudo iniciar Docker"
            exit 1
        }
    fi
    log_success "Docker está corriendo"
}

# Verificar archivos del proyecto
check_project_files() {
    log_info "Verificando archivos del proyecto..."
    
    local required_files=("package.json" "server.js" "Dockerfile" "docker-compose.yml")
    local missing_files=()
    
    for file in "${required_files[@]}"; do
        if [ -f "$file" ]; then
            log_success "$file - OK"
        else
            missing_files+=("$file")
        fi
    done
    
    if [ ${#missing_files[@]} -ne 0 ]; then
        log_error "Archivos faltantes: ${missing_files[*]}"
        log_info "Asegúrate de estar en el directorio correcto del proyecto"
        exit 1
    fi
    
    # Verificar directorio public
    if [ ! -d "public" ] || [ ! -f "public/index.html" ]; then
        log_error "Directorio public/ o archivo public/index.html no encontrado"
        exit 1
    fi
    log_success "Archivos del proyecto verificados"
}

# Crear estructura de directorios
create_directory_structure() {
    log_info "Creando estructura de directorios..."
    
    # Directorios necesarios
    local directories=("data" "backups" "logs" "nginx/ssl")
    
    for dir in "${directories[@]}"; do
        if [ ! -d "$dir" ]; then
            mkdir -p "$dir"
            log_success "Directorio creado: $dir"
        else
            log_info "Directorio ya existe: $dir"
        fi
    done
    
    # Crear archivos .gitkeep para directorios vacíos
    local gitkeep_dirs=("data" "backups" "nginx/ssl")
    for dir in "${gitkeep_dirs[@]}"; do
        if [ ! -f "$dir/.gitkeep" ]; then
            touch "$dir/.gitkeep"
            log_success "Archivo .gitkeep creado en: $dir"
        fi
    done
}

# Configurar permisos
setup_permissions() {
    log_info "Configurando permisos..."
    
    # Cambiar propietario de directorios de datos
    sudo chown -R $USER:$USER data/ backups/ logs/ 2>/dev/null || {
        chown -R $USER:$USER data/ backups/ logs/ 2>/dev/null || true
    }
    
    # Permisos de escritura para directorios de datos
    chmod -R 755 data/ backups/ logs/ nginx/ 2>/dev/null || true
    
    log_success "Permisos configurados"
}

# Crear backup si existe base de datos
create_backup() {
    if [ -f "data/tasks.db" ]; then
        log_info "Creando backup de base de datos existente..."
        local timestamp=$(date +%Y%m%d_%H%M%S)
        local backup_file="backups/quickplan_pre_deploy_${timestamp}.db"
        
        cp "data/tasks.db" "$backup_file"
        log_success "Backup creado: $backup_file"
    else
        log_info "No hay base de datos existente para backup"
    fi
}

# Detener servicios existentes
stop_existing_services() {
    log_info "Deteniendo servicios existentes..."
    
    # Detener docker compose si está corriendo
    if docker compose ps | grep -q "Up"; then
        docker compose down
        log_success "Servicios Docker Compose detenidos"
    else
        log_info "No hay servicios corriendo"
    fi
    
    # Limpiar contenedores huérfanos
    docker compose down --remove-orphans 2>/dev/null || true
}

# Construir imágenes Docker
build_docker_images() {
    log_info "Construyendo imágenes Docker..."
    
    # Limpiar imágenes antiguas
    docker system prune -f &>/dev/null || true
    
    # Construir imagen sin cache
    if docker compose build --no-cache; then
        log_success "Imágenes Docker construidas exitosamente"
    else
        log_error "Error construyendo imágenes Docker"
        exit 1
    fi
}

# Iniciar servicios
start_services() {
    log_info "Iniciando servicios de QuickPlan..."
    
    if docker compose up -d; then
        log_success "Servicios iniciados en modo detached"
    else
        log_error "Error iniciando servicios"
        exit 1
    fi
    
    # Esperar que los servicios inicien
    log_info "Esperando que los servicios inicien completamente..."
    sleep 15
}

# Verificar servicios
verify_services() {
    log_info "Verificando estado de servicios..."
    
    # Estado de contenedores
    echo ""
    echo "📊 Estado de contenedores:"
    docker compose ps
    
    # Verificar health check
    echo ""
    log_info "Probando health check..."
    local max_attempts=5
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s http://localhost/health > /dev/null 2>&1; then
            log_success "Health check OK"
            break
        else
            log_warning "Health check falló (intento $attempt/$max_attempts)"
            if [ $attempt -eq $max_attempts ]; then
                log_error "Health check falló después de $max_attempts intentos"
                log_info "Mostrando logs para diagnóstico:"
                docker compose logs --tail=20
            else
                sleep 5
            fi
        fi
        ((attempt++))
    done
    
    # Probar API
    log_info "Probando API de tareas..."
    if curl -s http://localhost/api/tasks > /dev/null 2>&1; then
        log_success "API de tareas responde correctamente"
    else
        log_warning "API de tareas no responde, pero el servicio puede estar iniciando"
    fi
}

# Mostrar información de acceso
show_access_info() {
    echo ""
    echo -e "${GREEN}============================================================="
    echo "🎉 ¡QuickPlan desplegado exitosamente!"
    echo "=============================================================${NC}"
    
    # Obtener IP pública
    local server_ip=$(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null || hostname -I | awk '{print $1}')
    
    echo ""
    echo "🌐 URLs de acceso:"
    echo "   • Aplicación principal: http://${server_ip}"
    echo "   • Health check: http://${server_ip}/health"
    echo "   • API REST: http://${server_ip}/api/tasks"
    echo "   • Estadísticas: http://${server_ip}/api/stats"
    echo ""
    echo "📊 Información del deployment:"
    echo "   • Fecha: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "   • Servidor: $(hostname)"
    echo "   • IP pública: ${server_ip}"
    echo "   • Ubicación: $(pwd)"
    echo ""
    echo "🛠️ Comandos útiles:"
    echo "   docker compose logs -f      # Ver logs en tiempo real"
    echo "   docker compose ps           # Estado de servicios"
    echo "   docker compose restart      # Reiniciar servicios"
    echo "   docker compose down         # Detener servicios"
    echo ""
    echo "🧪 Pasos siguientes:"
    echo "   1. Abrir http://${server_ip} en tu navegador"
    echo "   2. Verificar las 3 tareas de ejemplo"
    echo "   3. Agregar una nueva tarea"
    echo "   4. Generar y descargar reporte Excel"
    echo ""
    echo -e "${GREEN}=============================================================${NC}"
}

# Función principal
main() {
    print_banner
    
    # Verificaciones previas
    check_dependencies
    check_project_files
    
    # Preparación
    create_directory_structure
    setup_permissions
    create_backup
    
    # Deployment
    stop_existing_services
    build_docker_images
    start_services
    
    # Verificación
    verify_services
    
    # Información final
    show_access_info
    
    log_success "Deployment completado exitosamente!"
}

# Manejo de errores
trap 'log_error "Deployment falló en la línea $LINENO"' ERR

# Ejecutar función principal
main "$@"