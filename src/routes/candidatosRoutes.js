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

const uploadCV = upload.single('cv');

// Endpoint candidatos POST multipart/form-data (Mock temporal para Fase 2)
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
}, (req, res) => {
  const { nombre_completo, email, acepta_privacidad } = req.body;

  if (!req.file) {
    return res.status(400).json({
      status: 'error',
      message: 'El archivo CV (pdf, doc, docx) es obligatorio en el campo "cv".'
    });
  }

  // Validación de campos obligatorios
  if (!nombre_completo || !email || acepta_privacidad === undefined) {
    return res.status(400).json({
      status: 'error',
      message: 'Los campos nombre_completo, email y acepta_privacidad son obligatorios.'
    });
  }

  // Validación explícita de trazabilidad de privacidad
  const aceptaPrivacidadBool = acepta_privacidad === true || acepta_privacidad === 'true';
  if (!aceptaPrivacidadBool) {
    return res.status(400).json({
      status: 'error',
      message: 'Debe aceptar las políticas de privacidad para postularse (acepta_privacidad debe ser true).'
    });
  }

  // Mock de respuesta para la Fase 2
  return res.status(200).json({
    status: 'success',
    message: 'Validación de trama y archivo exitosa (Fase 2 Mock)',
    data: {
      nombre_completo,
      email,
      acepta_privacidad: aceptaPrivacidadBool,
      puesto_postulacion: req.body.puesto_postulacion || null,
      linkedin_url: req.body.linkedin_url || null,
      origen: req.body.origen || null,
      file: {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      }
    }
  });
});

export default router;
