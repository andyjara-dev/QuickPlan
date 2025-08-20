#!/bin/bash

# Diagnóstico del error 503 en QuickPlan
# Este script verifica los servicios y ayuda a identificar la causa

echo "🔍 DIAGNÓSTICO ERROR 503 - QuickPlan"
echo "===================================="
echo ""

# 1. Estado de los contenedores
echo "📦 ESTADO DE CONTENEDORES:"
echo "-------------------------"
docker compose ps
echo ""

# 2. Health checks
echo "🏥 HEALTH CHECKS:"
echo "----------------"
docker inspect quickplan-app --format='{{.State.Health.Status}}' 2>/dev/null || echo "Health check no disponible para quickplan-app"
echo ""

# 3. Logs recientes de la aplicación
echo "📋 LOGS RECIENTES - APLICACIÓN (últimas 20 líneas):"
echo "---------------------------------------------------"
docker compose logs --tail=20 quickplan-app
echo ""

# 4. Logs recientes de nginx
echo "🔧 LOGS RECIENTES - NGINX (últimas 20 líneas):"
echo "----------------------------------------------"
docker compose logs --tail=20 quickplan-nginx
echo ""

# 5. Conectividad interna
echo "🌐 CONECTIVIDAD INTERNA:"
echo "------------------------"
echo "Probando conectividad nginx -> app..."
docker exec quickplan-nginx wget -qO- --timeout=5 http://quickplan-app:3000/health 2>/dev/null && echo "✅ Conectividad OK" || echo "❌ Error de conectividad"

echo ""
echo "Probando health check directo..."
docker exec quickplan-app wget -qO- --timeout=5 http://localhost:3000/health 2>/dev/null && echo "✅ App responde OK" || echo "❌ App no responde"

echo ""

# 6. Puertos y procesos
echo "🔌 PUERTOS Y PROCESOS:"
echo "----------------------"
echo "Puertos expuestos:"
docker port quickplan-app 2>/dev/null || echo "No se pudieron obtener puertos de quickplan-app"
docker port quickplan-nginx 2>/dev/null || echo "No se pudieron obtener puertos de quickplan-nginx"

echo ""
echo "Procesos en el contenedor de la app:"
docker exec quickplan-app ps aux 2>/dev/null || echo "No se pudieron obtener procesos"

echo ""

# 7. Memoria y recursos
echo "💾 USO DE RECURSOS:"
echo "------------------"
docker stats --no-stream quickplan-app quickplan-nginx 2>/dev/null || echo "No se pudieron obtener estadísticas"

echo ""

# 8. Test directo del endpoint stats
echo "📊 TEST DIRECTO /api/stats:"
echo "---------------------------"
echo "Desde el host:"
curl -s -w "Status: %{http_code}\n" http://localhost/api/stats || echo "❌ Error conectando desde host"

echo ""
echo "Desde dentro del contenedor nginx:"
docker exec quickplan-nginx wget -qO- --timeout=5 http://quickplan-app:3000/api/stats 2>/dev/null && echo "✅ Stats OK desde nginx" || echo "❌ Error obteniendo stats desde nginx"

echo ""

# 9. Configuración de nginx
echo "⚙️  CONFIGURACIÓN NGINX:"
echo "------------------------"
echo "Verificando configuración de nginx..."
docker exec quickplan-nginx nginx -t 2>&1

echo ""

# 10. Recomendaciones
echo "💡 RECOMENDACIONES:"
echo "------------------"
echo "1. Si hay errores de conectividad, reinicia los servicios:"
echo "   ./admin-quickplan.sh restart"
echo ""
echo "2. Si la app no responde, verifica los logs:"
echo "   ./admin-quickplan.sh logs-app"
echo ""
echo "3. Si nginx tiene problemas, verifica la configuración:"
echo "   ./admin-quickplan.sh logs-nginx"
echo ""
echo "4. Para monitoring en tiempo real:"
echo "   ./admin-quickplan.sh logs -f"
echo ""

echo "🏁 Diagnóstico completado."
