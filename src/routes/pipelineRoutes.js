import express from 'express';
import {
  crearPipeline,
  obtenerPipeline,
  obtenerPipelineById,
  actualizarPipeline,
  eliminarPipeline,
  evaluarScreeningPipeline
} from '../controllers/pipelineController.js';
import { verificarToken } from '../middlewares/authMiddleware.js';

const router = express.Router();

// POST /api/v1/pipeline - Crea un vínculo candidatos-búsqueda en el flujo
router.post('/', verificarToken, crearPipeline);

// GET /api/v1/pipeline - Lista el tablero filtrado por id_busqueda y estado_actual opcional
router.get('/', verificarToken, obtenerPipeline);

// GET /api/v1/pipeline/:id - Retorna un único registro de pipeline por ID documental
router.get('/:id', verificarToken, obtenerPipelineById);

// POST /api/v1/pipeline/:id/evaluar-screening - Ejecuta el Motor de Inferencia con IA para Criterios de Aceptación
router.post('/:id/evaluar-screening', verificarToken, evaluarScreeningPipeline);

// PATCH /api/v1/pipeline/:id - Actualización de estado y análisis IA en el pipeline
router.patch('/:id', verificarToken, actualizarPipeline);

// DELETE /api/v1/pipeline/:id - Elimina el vínculo físico del pipeline
router.delete('/:id', verificarToken, eliminarPipeline);

export default router;

