// CRÍTICO: dotenv/config debe ser la primera importación para evitar la condición
// de carrera con los módulos que leen process.env en su inicialización (ej: bigquery.js)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import busquedasRoutes from './src/routes/busquedasRoutes.js';
import candidatosRoutes from './src/routes/candidatosRoutes.js';

const app = express();
const PORT = process.env.PORT || 8080;

// Configuración dinámica de CORS basada en ALLOWED_ORIGINS
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim().toLowerCase())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Permitir peticiones si no hay cabecera Origin (curl, postman, etc.)
    // o si el origen está explícitamente en la lista blanca de orígenes
    if (!origin || allowedOrigins.includes(origin.toLowerCase())) {
      callback(null, true);
    } else {
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

// Manejador de errores para interceptar violaciones de CORS y otros errores de Express
app.use((err, req, res, next) => {
  if (err.message === 'Origen no permitido por CORS') {
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
