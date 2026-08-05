import express from 'express';
import multer from 'multer';

const router = express.Router();

// Configuración de Multer para carga en memoria
const storage = multer.memoryStorage();

// Filtro de formato para permitir únicamente PDF, DOC y DOCX
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  const allowedExtensions = /\.(pdf|doc|docx)$/i;

  if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.test(file.originalname)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de archivo no permitido. Solo se aceptan formatos PDF, DOC y DOCX.'), false);
  }
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // Límite de 5MB
  },
  fileFilter: fileFilter
});

import { verificarToken } from '../middlewares/authMiddleware.js';
import { registrarCandidato, obtenerCandidatos, actualizarCandidato, obtenerDocumentoCV, importarCandidatoIA } from '../controllers/candidatosController.js';

const uploadCV = upload.single('cv');

// Endpoint candidatos POST multipart/form-data (Integrado con controlador real B2C público)
router.post('/', (req, res, next) => {
  uploadCV(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        status: 'error',
        message: err.message || 'Error al procesar la carga del archivo.'
      });
    }
    next();
  });
}, registrarCandidato);

// Endpoints administrativos B2B (Protegidos)
router.get('/', verificarToken, obtenerCandidatos);
router.get('/:id/cv', verificarToken, obtenerDocumentoCV);
router.patch('/:id', verificarToken, actualizarCandidato);

// Endpoint administrativo B2B de importación asistida por Inteligencia Artificial (Genkit + Vertex AI)
router.post('/importar-ia', verificarToken, (req, res, next) => {
  uploadCV(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        status: 'error',
        message: err.message || 'Error al procesar la carga del archivo.'
      });
    }
    next();
  });
}, importarCandidatoIA);

/*
// MEJORA FUTURA: Ruta DELETE /:id comentada para borrado físico (Super Administrador)
// El descarte ordinario (Soft Delete) se gestiona de forma estándar mediante el PATCH anterior (estado_revision = 'Descartado').
// Para habilitar el borrado total físico de cumplimiento RGPD, descomentar las siguientes líneas:
// import { eliminarCandidatoFisico } from '../controllers/candidatosController.js';
// router.delete('/:id', verificarToken, eliminarCandidatoFisico);
*/

export default router;

