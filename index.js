// CRÍTICO: dotenv/config debe ser la primera importación para evitar la condición
// de carrera con los módulos que leen process.env en su inicialización (ej: bigquery.js)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import busquedasRoutes from './src/routes/busquedasRoutes.js';
import candidatosRoutes from './src/routes/candidatosRoutes.js';
import pipelineRoutes from './src/routes/pipelineRoutes.js';

const app = express();
const PORT = process.env.PORT || 8080;

// =============================================================================
// CORS Dinámico por Entorno
// -----------------------------------------------------------------------------
// Producción (NODE_ENV=production):
//   Solo se permiten los orígenes declarados en ALLOWED_ORIGINS (lista exacta).
//   Cualquier otro origen es bloqueado con HTTP 403.
//
// Staging / Desarrollo (NODE_ENV != production):
//   Además de la whitelist, se autorizan dinámicamente las URLs de preview
//   generadas por Firebase App Hosting (*.hosted.app) mediante Regex,
//   eliminando la necesidad de actualizar la variable manualmente en cada rama.
// =============================================================================

// Lista blanca de orígenes desde variable de entorno (separados por coma)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim().toLowerCase())
  .filter(Boolean);

// Regex para URLs de preview de Firebase App Hosting
// Cubre el patrón: https://[proyecto]--[branch-hash].hosted.app
const FIREBASE_PREVIEW_REGEX = /^https:\/\/[a-zA-Z0-9-]+(--[a-zA-Z0-9-]+)?\.hosted\.app$/;

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Resuelve si un origen está autorizado según el entorno activo.
 * @param {string|undefined} origin - Cabecera Origin de la petición entrante.
 * @returns {boolean}
 */
export function isOriginAllowed(origin) {
  if (!origin) return true; // curl, Postman, health checks de Cloud Run

  const normalizedOrigin = origin.toLowerCase();
  const isInAllowlist = allowedOrigins.includes(normalizedOrigin);

  if (isProduction) {
    // Producción: estricto — solo orígenes explícitos en la whitelist
    return isInAllowlist;
  } else {
    // Staging/Desarrollo: whitelist + previews dinámicos de Firebase App Hosting
    return isInAllowlist || FIREBASE_PREVIEW_REGEX.test(origin);
  }
}

const corsOptions = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      console.warn(`[SECURITY] Petición bloqueada por CORS. Entorno: ${process.env.NODE_ENV || 'development'}. Origen rechazado: ${origin}`);
      callback(new Error('Origen no permitido por CORS'));
    }
  },
  credentials: true
};

// Middleware para poder recibir peticiones con cuerpo JSON
app.use(express.json());

// Endpoint inicial de prueba
app.get('/ping', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Azul ATS API operativa'
  });
});

// Registrar rutas del microservicio bajo el prefijo correspondiente
app.use('/api/v1/busquedas', busquedasRoutes);
app.use('/api/v1/candidatos', cors(corsOptions), candidatosRoutes);
app.use('/api/v1/pipeline', cors(corsOptions), pipelineRoutes);

// Manejador de errores para interceptar violaciones de CORS y otros errores de Express
app.use((err, req, res, next) => {
  if (err.message === 'Origen no permitido por CORS') {
    console.warn(`[SECURITY] Petición bloqueada por CORS. Origen rechazado: ${req.headers.origin}`);
    return res.status(403).json({
      status: 'error',
      message: 'Acceso denegado por políticas de CORS (origen no permitido).'
    });
  }
  // Manejador general por defecto
  res.status(500).json({
    status: 'error',
    message: err.message || 'Error interno del servidor.'
  });
});

// Inicia el servidor
app.listen(PORT, () => {
  console.log(`Servidor Express escuchando en el puerto ${PORT}`);
});
