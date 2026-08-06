# ============================================================
# Azul ATS — Microservicio Backend
# Imagen base: Node.js 24 Alpine (mínima, segura y optimizada)
# Plataforma de destino: Google Cloud Run (us-east1)
# ============================================================

FROM node:24-alpine

# Directorio de trabajo dentro del contenedor
WORKDIR /usr/src/app

# Copiar manifiestos primero para aprovechar la caché de capas de Docker:
# si package.json no cambia, npm install no se re-ejecuta en cada build.
COPY package*.json ./

# Instalar solo dependencias de producción (sin devDependencies)
RUN npm install --production

# Copiar el resto del código fuente al contenedor
COPY . .

# Puerto estándar de Google Cloud Run
EXPOSE 8080

# Comando de inicio del microservicio
CMD [ "npm", "start" ]
