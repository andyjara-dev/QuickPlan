#!/bin/bash

echo "⚡ Subiendo QuickPlan a GitHub..."

# Configurar Git (si no está configurado)
git config --global user.name "andyjara-dev"
git config --global user.email "tu-email@gmail.com"  # Cambia por tu email

# Crear directorio del proyecto
mkdir -p quickplan-manager
cd quickplan-manager

# Inicializar repositorio
git init
git branch -M main

# Crear estructura de directorios
mkdir -p {public,nginx,data,backups,nginx/ssl}
touch data/.gitkeep backups/.gitkeep nginx/ssl/.gitkeep

# Aquí debes crear todos los archivos que te mostré arriba
# (package.json, Dockerfile, docker-compose.yml, etc.)

# Agregar archivos al repositorio
git add .

# Hacer primer commit
git commit -m "🚀 Versión inicial de QuickPlan

✨ Características:
- Sistema de gestión de tareas con Vue.js
- Exportación a Excel con títulos personalizables
- Deployment con Docker y Docker Compose
- Interfaz responsiva con Quasar Framework
- Backup automático de base de datos SQLite
- Proxy reverso con Nginx

🛠️ Tecnologías:
- Frontend: Vue.js 3 + Quasar
- Backend: Node.js + Express
- Base de datos: SQLite
- Containerización: Docker
- Autor: andyjara-dev"

# Conectar con repositorio remoto
git remote add origin https://github.com/andyjara-dev/quickplan-manager.git

# Subir a GitHub
git push -u origin main

echo "✅ QuickPlan subido exitosamente a GitHub!"
echo "🌐 URL del repositorio: https://github.com/andyjara-dev/quickplan-manager"