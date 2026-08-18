import express from 'express';
import multer from 'multer';
import { validarSendGridSecret } from '../middlewares/sendgridAuthMiddleware.js';
import { procesarInboundCV } from '../controllers/webhooksController.js';

const router = express.Router();

// Configuración de Multer para carga multipart en memoria (Límite 25MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

/**
 * POST /api/v1/webhooks/inbound-cv
 * Endpoint público interceptador de correos de SendGrid Inbound Parse.
 * Requiere el query parameter `?secret=...` configurado.
 */
router.post(
  '/inbound-cv',
  validarSendGridSecret,
  upload.any(),
  procesarInboundCV
);

export default router;
