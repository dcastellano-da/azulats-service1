import express from 'express';
import multer from 'multer';
import {
  crearPipeline,
  obtenerPipeline,
  obtenerPipelineById,
  actualizarPipeline,
  eliminarPipeline,
  evaluarScreeningPipeline,
  analizarTranscripcionPipeline,
  analizarTestPersonalidadPipeline
} from '../controllers/pipelineController.js';
import { verificarToken } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Configuración de Multer para carga de transcripción en memoria RAM
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ];
  const allowedExtensions = /\.(pdf|doc|docx|txt)$/i;

  if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.test(file.originalname)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido para la transcripción. Solo se aceptan formatos PDF, DOC, DOCX y TXT.'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // Límite de 5MB
  },
  fileFilter: fileFilter
});

const uploadTranscripcion = upload.single('transcripcion');

// Configuración de Multer para carga de test de personalidad (imágenes) en memoria RAM
const imageFileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp'
  ];
  const allowedExtensions = /\.(png|jpg|jpeg|webp)$/i;

  if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.test(file.originalname)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido. Solo se aceptan formatos de imagen (PNG, JPG, JPEG, WEBP).'), false);
  }
};

const uploadImagenMulter = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // Límite de 5MB
  },
  fileFilter: imageFileFilter
});

const uploadTestPersonalidadFields = uploadImagenMulter.fields([
  { name: 'imagen', maxCount: 1 },
  { name: 'file', maxCount: 1 }
]);

const uploadTestPersonalidad = (req, res, next) => {
  uploadTestPersonalidadFields(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        status: 'error',
        message: err.message || 'Error al procesar la carga de la imagen del test de personalidad.'
      });
    }
    if (!req.file && req.files) {
      if (req.files.imagen && req.files.imagen.length > 0) {
        req.file = req.files.imagen[0];
      } else if (req.files.file && req.files.file.length > 0) {
        req.file = req.files.file[0];
      }
    }
    next();
  });
};

// POST /api/v1/pipeline - Crea un vínculo candidatos-búsqueda en el flujo
router.post('/', verificarToken, crearPipeline);

// GET /api/v1/pipeline - Lista el tablero filtrado por id_busqueda y estado_actual opcional
router.get('/', verificarToken, obtenerPipeline);

// GET /api/v1/pipeline/:id - Retorna un único registro de pipeline por ID documental
router.get('/:id', verificarToken, obtenerPipelineById);

// POST /api/v1/pipeline/:id/evaluar-screening - Ejecuta el Motor de Inferencia con IA para Criterios de Aceptación
router.post('/:id/evaluar-screening', verificarToken, evaluarScreeningPipeline);

// POST /api/v1/pipeline/:id/analizar-transcripcion - Procesa la transcripción de entrevista con IA (Vertex AI / Gemini)
router.post('/:id/analizar-transcripcion', verificarToken, (req, res, next) => {
  uploadTranscripcion(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        status: 'error',
        message: err.message || 'Error al procesar la carga de la transcripción.'
      });
    }
    next();
  });
}, analizarTranscripcionPipeline);

// POST /api/v1/pipeline/:id/analizar-personalidad - Analiza captura de test de personalidad con IA (Gemini 2.5 Flash)
router.post('/:id/analizar-personalidad', verificarToken, uploadTestPersonalidad, analizarTestPersonalidadPipeline);

// PATCH /api/v1/pipeline/:id - Actualización de estado y análisis IA en el pipeline
router.patch('/:id', verificarToken, actualizarPipeline);

// DELETE /api/v1/pipeline/:id - Elimina el vínculo físico del pipeline
router.delete('/:id', verificarToken, eliminarPipeline);

export default router;
