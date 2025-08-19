# Usar imagen oficial de Node.js Alpine (más liviana)
FROM node:18-alpine

# Instalar dependencias del sistema para SQLite
RUN apk add --no-cache sqlite curl

# Crear usuario no-root para seguridad
RUN addgroup -g 1001 -S quickplan && \
    adduser -S quickplan -u 1001

# Establecer directorio de trabajo
WORKDIR /app

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias de producción
RUN npm ci --only=production && npm cache clean --force

# Copiar código fuente
COPY . .

# Crear directorio para base de datos con permisos correctos
RUN mkdir -p /app/data && \
    chown -R quickplan:quickplan /app

# Cambiar a usuario no-root
USER quickplan

# Exponer puerto
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Comando de inicio
CMD ["node", "server.js"]