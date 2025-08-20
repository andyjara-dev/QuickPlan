#!/bin/bash

# =============================================================================
# 🛠️ QuickPlan Administration Script
# =============================================================================
# Autor: andyjara-dev
# Descripción: Script de administración completo para QuickPlan
# =============================================================================

set -e

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

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

log_header() {
    echo -e "${PURPLE}🔧 $1${NC}"
}

# Banner principal
print_banner() {
    echo -e "${CYAN}"
    echo "============================================================="
    echo "🛠️  QuickPlan Administration Console"
    echo "============================================================="
    echo "Fecha: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "Usuario: $(whoami)"
    echo "Directorio: $(pwd)"
    echo "Servidor: $(hostname)"
    echo "============================================================="
    echo -e "${NC}"
}

# Mostrar ayuda
show_help() {
    echo -e "${BLUE}📖 Comandos disponibles:${NC}"
    echo ""
    echo "🚀 Gestión de servicios:"
    echo "  start          Iniciar QuickPlan"
    echo "  stop           Detener servicios"
    echo "  restart        Reiniciar sistema"
    echo "  status         Estado de servicios"
    echo ""
    echo "📊 Monitoreo:"
    echo "  logs           Ver logs en tiempo real"
    echo "  logs-app       Logs solo de la aplicación"
    echo "  logs-nginx     Logs solo de Nginx"
    echo "  stats          Estadísticas de recursos"
    echo "  health         Verificar health checks"
    echo "  diagnose       Diagnóstico completo error 503"
    echo ""
    echo "🔧 Mantenimiento:"
    echo "  backup         Crear backup manual"
    echo "  restore        Restaurar desde backup"
    echo "  update         Actualizar desde Git"
    echo "  clean          Limpiar recursos Docker"
    echo "  reset          Reset completo (¡CUIDADO!)"
    echo ""
    echo "🔍 Información:"
    echo "  info           Información del sistema"
    echo "  version        Versión de QuickPlan"
    echo "  urls           URLs de acceso"
    echo "  help           Mostrar esta ayuda"
    echo ""
    echo -e "${YELLOW}Ejemplo: ./admin-quickplan.sh start${NC}"
}

# Verificar que estamos en el directorio correcto
check_directory() {
    if [ ! -f "docker-compose.yml" ] || [ ! -f "package.json" ]; then
        log_error "No estás en el directorio raíz de QuickPlan"
        exit 1
    fi
}

# Iniciar servicios
start_services() {
    log_header "Iniciando QuickPlan..."
    
    if docker compose ps | grep -q "Up"; then
        log_warning "Los servicios ya están corriendo"
        show_status
        return
    fi
    
    docker compose up -d
    log_success "Servicios iniciados"
    
    log_info "Esperando que los servicios inicien..."
    sleep 10
    
    show_health_check
}

# Detener servicios
stop_services() {
    log_header "Deteniendo servicios..."
    
    docker compose down
    log_success "Servicios detenidos"
}

# Reiniciar servicios
restart_services() {
    log_header "Reiniciando QuickPlan..."
    
    stop_services
    sleep 3
    start_services
}

# Mostrar estado
show_status() {
    log_header "Estado de servicios"
    echo ""
    docker compose ps
    echo ""
    
    # Verificar puertos
    log_info "Verificando puertos..."
    if netstat -tuln | grep -q ":80 "; then
        log_success "Puerto 80 (HTTP) activo"
    else
        log_warning "Puerto 80 no está en uso"
    fi
    
    if netstat -tuln | grep -q ":3000 "; then
        log_success "Puerto 3000 (App) activo"
    else
        log_warning "Puerto 3000 no está en uso"
    fi
}

# Ver logs
show_logs() {
    local service=${1:-""}
    
    log_header "Logs de QuickPlan"
    
    if [ -n "$service" ]; then
        docker compose logs -f "$service"
    else
        docker compose logs -f
    fi
}

# Estadísticas del sistema
show_stats() {
    log_header "Estadísticas del sistema"
    echo ""
    
    # Uso de disco
    echo "💾 Uso de disco:"
    df -h | grep -E "(Filesystem|/$)"
    echo ""
    
    # Uso de memoria
    echo "🧠 Uso de memoria:"
    free -h
    echo ""
    
    # Contenedores Docker
    echo "🐳 Contenedores Docker:"
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"
    echo ""
    
    # Tamaño de la base de datos
    if [ -f "data/tasks.db" ]; then
        local db_size=$(du -h data/tasks.db | cut -f1)
        echo "📊 Base de datos: $db_size"
    fi
    
    # Número de backups
    local backup_count=$(ls -1 backups/*.db 2>/dev/null | wc -l)
    echo "💾 Backups disponibles: $backup_count"
}

# Health check
show_health_check() {
    log_header "Verificando health checks"
    
    local server_ip="localhost"
    
    # Health check endpoint
    if curl -s "http://$server_ip/health" > /dev/null; then
        log_success "Health check OK"
    else
        log_error "Health check falló"
    fi
    
    # API de tareas
    if curl -s "http://$server_ip/api/tasks" > /dev/null; then
        log_success "API de tareas OK"
    else
        log_error "API de tareas falló"
    fi
    
    # Aplicación principal
    if curl -s "http://$server_ip/" > /dev/null; then
        log_success "Aplicación principal OK"
    else
        log_error "Aplicación principal falló"
    fi
}

# Diagnóstico completo para error 503
diagnose_503() {
    log_header "Diagnóstico completo - Error 503"
    echo ""
    
    # 1. Estado de contenedores
    log_info "1. Estado de contenedores:"
    docker compose ps
    echo ""
    
    # 2. Health checks
    log_info "2. Health checks de Docker:"
    local app_health=$(docker inspect quickplan-app --format='{{.State.Health.Status}}' 2>/dev/null || echo "no disponible")
    echo "   App: $app_health"
    echo ""
    
    # 3. Conectividad interna
    log_info "3. Probando conectividad interna:"
    if docker exec quickplan-nginx wget -qO- --timeout=5 http://quickplan-app:3000/health 2>/dev/null >/dev/null; then
        log_success "   Nginx -> App: OK"
    else
        log_error "   Nginx -> App: FALLO"
    fi
    
    if docker exec quickplan-app wget -qO- --timeout=5 http://localhost:3000/health 2>/dev/null >/dev/null; then
        log_success "   App local: OK"
    else
        log_error "   App local: FALLO"
    fi
    echo ""
    
    # 4. Test del endpoint stats específicamente
    log_info "4. Test específico /api/stats:"
    local stats_response=$(curl -s -w "%{http_code}" http://localhost/api/stats -o /dev/null 2>/dev/null || echo "000")
    if [ "$stats_response" = "200" ]; then
        log_success "   /api/stats: OK (200)"
    else
        log_error "   /api/stats: FALLO ($stats_response)"
    fi
    echo ""
    
    # 5. Logs recientes
    log_info "5. Logs recientes (últimas 10 líneas):"
    echo "   --- App ---"
    docker compose logs --tail=10 quickplan-app 2>/dev/null || echo "   No disponible"
    echo ""
    echo "   --- Nginx ---"
    docker compose logs --tail=10 quickplan-nginx 2>/dev/null || echo "   No disponible"
    echo ""
    
    # 6. Recursos
    log_info "6. Uso de recursos:"
    docker stats --no-stream quickplan-app quickplan-nginx 2>/dev/null || echo "   No disponible"
    echo ""
    
    # 7. Configuración nginx
    log_info "7. Verificación nginx:"
    if docker exec quickplan-nginx nginx -t 2>/dev/null; then
        log_success "   Configuración nginx: OK"
    else
        log_error "   Configuración nginx: PROBLEMA"
    fi
    echo ""
    
    # 8. Recomendaciones
    log_header "RECOMENDACIONES:"
    echo "• Si hay errores de conectividad: ./admin-quickplan.sh restart"
    echo "• Para logs detallados: ./admin-quickplan.sh logs"
    echo "• Para rebuild completo: ./admin-quickplan.sh stop && docker compose build --no-cache && ./admin-quickplan.sh start"
    echo "• Script específico: ./diagnostico-503.sh"
}

# Crear backup
create_backup() {
    log_header "Creando backup manual"
    
    if [ ! -f "data/tasks.db" ]; then
        log_error "No hay base de datos para backup"
        return 1
    fi
    
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="backups/quickplan_manual_${timestamp}.db"
    
    cp "data/tasks.db" "$backup_file"
    log_success "Backup creado: $backup_file"
    
    # Mostrar información del backup
    local backup_size=$(du -h "$backup_file" | cut -f1)
    log_info "Tamaño del backup: $backup_size"
    
    # Limpiar backups antiguos (mantener últimos 10)
    local backup_count=$(ls -1t backups/*.db 2>/dev/null | wc -l)
    if [ "$backup_count" -gt 10 ]; then
        log_info "Limpiando backups antiguos..."
        ls -1t backups/*.db | tail -n +11 | xargs rm -f
        log_success "Backups antiguos eliminados"
    fi
}

# Restaurar backup
restore_backup() {
    log_header "Restaurar desde backup"
    
    # Listar backups disponibles
    local backups=($(ls -1t backups/*.db 2>/dev/null))
    
    if [ ${#backups[@]} -eq 0 ]; then
        log_error "No hay backups disponibles"
        return 1
    fi
    
    echo "📋 Backups disponibles:"
    for i in "${!backups[@]}"; do
        local backup_file="${backups[$i]}"
        local backup_size=$(du -h "$backup_file" | cut -f1)
        local backup_date=$(stat -c %y "$backup_file" | cut -d' ' -f1,2 | cut -d'.' -f1)
        echo "  $((i+1)). $(basename "$backup_file") ($backup_size, $backup_date)"
    done
    
    echo ""
    read -p "Selecciona backup (1-${#backups[@]}): " backup_choice
    
    if [[ "$backup_choice" =~ ^[0-9]+$ ]] && [ "$backup_choice" -ge 1 ] && [ "$backup_choice" -le ${#backups[@]} ]; then
        local selected_backup="${backups[$((backup_choice-1))]}"
        
        log_warning "⚠️  Esto sobrescribirá la base de datos actual"
        read -p "¿Continuar? (y/N): " confirm
        
        if [[ "$confirm" =~ ^[Yy]$ ]]; then
            # Crear backup de seguridad antes de restaurar
            if [ -f "data/tasks.db" ]; then
                local safety_backup="backups/quickplan_pre_restore_$(date +%Y%m%d_%H%M%S).db"
                cp "data/tasks.db" "$safety_backup"
                log_info "Backup de seguridad creado: $safety_backup"
            fi
            
            # Restaurar
            cp "$selected_backup" "data/tasks.db"
            log_success "Base de datos restaurada desde: $(basename "$selected_backup")"
            
            # Reiniciar servicios
            restart_services
        else
            log_info "Restauración cancelada"
        fi
    else
        log_error "Selección inválida"
    fi
}

# Actualizar desde Git
update_from_git() {
    log_header "Actualizando desde Git"
    
    # Verificar que hay un repositorio Git
    if [ ! -d ".git" ]; then
        log_error "No es un repositorio Git"
        return 1
    fi
    
    # Backup antes de actualizar
    create_backup
    
    # Pull cambios
    log_info "Descargando cambios..."
    git pull origin main
    
    # Reinstalar dependencias si package.json cambió
    if git diff --name-only HEAD~1 HEAD | grep -q "package.json"; then
        log_info "package.json cambió, reinstalando dependencias..."
        npm install
    fi
    
    # Rebuild y restart
    log_info "Reconstruyendo servicios..."
    docker compose build --no-cache
    restart_services
    
    log_success "Actualización completada"
}

# Limpiar recursos Docker
clean_docker() {
    log_header "Limpiando recursos Docker"
    
    log_warning "Esto eliminará imágenes, contenedores y volúmenes no utilizados"
    read -p "¿Continuar? (y/N): " confirm
    
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
        docker system prune -f
        docker volume prune -f
        docker image prune -a -f
        log_success "Recursos Docker limpiados"
    else
        log_info "Limpieza cancelada"
    fi
}

# Reset completo
reset_system() {
    log_header "Reset completo del sistema"
    
    log_error "⚠️  PELIGRO: Esto eliminará TODOS los datos"
    echo "  • Base de datos actual"
    echo "  • Todos los backups"
    echo "  • Logs del sistema"
    echo "  • Contenedores e imágenes Docker"
    echo ""
    read -p "Escribe 'RESET' para confirmar: " confirm
    
    if [ "$confirm" = "RESET" ]; then
        log_warning "Iniciando reset completo..."
        
        # Detener servicios
        docker compose down --volumes --remove-orphans
        
        # Eliminar datos
        rm -rf data/*.db backups/*.db logs/*.log
        
        # Limpiar Docker
        docker system prune -a -f
        docker volume prune -f
        
        # Recrear estructura
        ./crear-estructura.sh
        
        log_success "Reset completo finalizado"
        log_info "Sistema restaurado a estado inicial"
    else
        log_info "Reset cancelado"
    fi
}

# Mostrar información del sistema
show_info() {
    log_header "Información del sistema"
    echo ""
    
    # Versión de QuickPlan
    if [ -f "package.json" ]; then
        local version=$(grep '"version"' package.json | cut -d'"' -f4)
        echo "📦 QuickPlan versión: $version"
    fi
    
    # Node.js
    if command -v node &> /dev/null; then
        echo "🟢 Node.js: $(node --version)"
    fi
    
    # Docker
    if command -v docker &> /dev/null; then
        echo "🐳 Docker: $(docker --version | cut -d' ' -f3 | tr -d ',')"
    fi
    
    # Sistema operativo
    echo "💻 SO: $(uname -s) $(uname -r)"
    
    # Arquitectura
    echo "🔧 Arquitectura: $(uname -m)"
    
    # Uptime
    echo "⏱️  Uptime: $(uptime -p 2>/dev/null || uptime)"
    
    # IP pública
    local public_ip=$(curl -s ifconfig.me 2>/dev/null || echo "No disponible")
    echo "🌐 IP pública: $public_ip"
    
    echo ""
}

# Mostrar URLs de acceso
show_urls() {
    local server_ip=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
    
    log_header "URLs de acceso"
    echo ""
    echo "🌐 Aplicación principal:"
    echo "   http://$server_ip"
    echo "   http://localhost (local)"
    echo ""
    echo "🔍 API y monitoring:"
    echo "   http://$server_ip/health"
    echo "   http://$server_ip/api/tasks"
    echo "   http://$server_ip/api/stats"
    echo ""
}

# Función principal
main() {
    check_directory
    
    case "${1:-help}" in
        "start")
            start_services
            ;;
        "stop")
            stop_services
            ;;
        "restart")
            restart_services
            ;;
        "status")
            show_status
            ;;
        "logs")
            show_logs
            ;;
        "logs-app")
            show_logs "quickplan-app"
            ;;
        "logs-nginx")
            show_logs "quickplan-nginx"
            ;;
        "stats")
            show_stats
            ;;
        "health")
            show_health_check
            ;;
        "diagnose")
            diagnose_503
            ;;
        "backup")
            create_backup
            ;;
        "restore")
            restore_backup
            ;;
        "update")
            update_from_git
            ;;
        "clean")
            clean_docker
            ;;
        "reset")
            reset_system
            ;;
        "info")
            show_info
            ;;
        "version")
            if [ -f "package.json" ]; then
                grep '"version"' package.json | cut -d'"' -f4
            else
                echo "No disponible"
            fi
            ;;
        "urls")
            show_urls
            ;;
        "help"|*)
            print_banner
            show_help
            ;;
    esac
}

# Ejecutar función principal
main "$@"
