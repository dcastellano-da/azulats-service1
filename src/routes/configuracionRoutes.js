import express from 'express';
import multer from 'multer';
import {
  obtenerConfiguracionAgencia,
  guardarConfiguracionAgencia,
  cargarLogoAgencia
} from '../controllers/configuracionController.js';
import { verificarToken } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Multer memoryStorage para subida de imágenes de logo en RAM
const storage = multer.memoryStorage();
const imageFileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/svg+xml'
  ];
  const allowedExtensions = /\.(png|jpg|jpeg|webp|svg)$/i;

  if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.test(file.originalname)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido. Solo se aceptan formatos de imagen para el logo (PNG, JPG, JPEG, WEBP, SVG).'), false);
  }
};

const uploadMulter = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // Límite 5MB
  },
  fileFilter: imageFileFilter
});

const uploadLogoFields = uploadMulter.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'file', maxCount: 1 }
]);

const uploadLogoMiddleware = (req, res, next) => {
  uploadLogoFields(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        status: 'error',
        message: err.message || 'Error al procesar la carga del logo de la agencia.'
      });
    }
    if (!req.file && req.files) {
      if (req.files.logo && req.files.logo.length > 0) {
        req.file = req.files.logo[0];
      } else if (req.files.file && req.files.file.length > 0) {
        req.file = req.files.file[0];
      }
    }
    next();
  });
};

// GET /api/v1/configuracion-agencia - Obtiene la configuración de la agencia
router.get('/', verificarToken, obtenerConfiguracionAgencia);

// POST /api/v1/configuracion-agencia - Guarda o actualiza la configuración de la agencia
router.post('/', verificarToken, guardarConfiguracionAgencia);

// PUT /api/v1/configuracion-agencia - Alias para actualización de configuración de la agencia
router.put('/', verificarToken, guardarConfiguracionAgencia);

// POST /api/v1/configuracion-agencia/logo - Carga la imagen de logo de la agencia en Storage
router.post('/logo', verificarToken, uploadLogoMiddleware, cargarLogoAgencia);

export default router;
