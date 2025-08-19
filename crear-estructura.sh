# Crear directorios necesarios
mkdir -p {public,nginx,data,backups,nginx/ssl}

# Crear archivos placeholder para directorios vacíos
touch data/.gitkeep
touch backups/.gitkeep
touch nginx/ssl/.gitkeep