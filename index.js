// CRÍTICO: dotenv/config debe ser la primera importación para evitar la condición
// de carrera con los módulos que leen process.env en su inicialización (ej: bigquery.js)
import 'dotenv/config';
import express from 'express';
import busquedasRoutes from './src/routes/busquedasRoutes.js';

const app = express();
const PORT = process.env.PORT || 8080;

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

// Inicia el servidor
app.listen(PORT, () => {
  console.log(`Servidor Express escuchando en el puerto ${PORT}`);
});
