/**
 * Middleware para validar el webhook de SendGrid Inbound Parse.
 *
 * Verifica que el Query Parameter `?secret=...` coincida con la variable de entorno
 * `SENDGRID_INBOUND_WEBHOOK_SECRET`.
 *
 * En entorno de prueba (NODE_ENV === 'test'), permite bypass si el secret es 'mock-secret-test'.
 */
export const validarSendGridSecret = (req, res, next) => {
  const secretParam = req.query.secret;
  const expectedSecret = process.env.SENDGRID_INBOUND_WEBHOOK_SECRET;

  // Bypass para testing con Jest
  if (process.env.NODE_ENV === 'test' && secretParam === 'mock-secret-test') {
    return next();
  }

  if (!expectedSecret) {
    console.error('[SECURITY ERROR] SENDGRID_INBOUND_WEBHOOK_SECRET no está configurada en el servidor.');
    return res.status(500).json({
      status: 'error',
      message: 'Error de configuración de seguridad en el servidor.'
    });
  }

  if (!secretParam || secretParam !== expectedSecret) {
    console.warn(`[SECURITY] Intento de acceso no autorizado al webhook Inbound CV. IP: ${req.ip} | Secret proporcionado: ${secretParam || 'ausente'}`);
    return res.status(401).json({
      status: 'error',
      message: 'Acceso denegado. Token secreto de webhook inválido o ausente.'
    });
  }

  next();
};
