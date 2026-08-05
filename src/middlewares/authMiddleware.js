import { getAuth } from 'firebase-admin/auth';

/**
 * Middleware de autenticación JWT — Azul ATS
 *
 * Valida el token de Firebase incluido en el header Authorization: Bearer <TOKEN>.
 * Si el token es válido, inyecta el payload decodificado en req.user y cede el control.
 * Si falta el token → HTTP 401 Unauthorized.
 * Si el token es inválido o ha expirado → HTTP 403 Forbidden.
 */
export const verificarToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : null;

  // Fallback a parámetro de consulta para solicitudes del navegador (descargas directas de CV)
  if (!token && req.query.token) {
    token = req.query.token;
  }

  // Sin token → el cliente no se ha identificado en absoluto
  if (!token) {
    return res.status(401).json({
      status: 'error',
      code: 'TOKEN_AUSENTE',
      message: 'Acceso denegado. Se requiere el header Authorization: Bearer <token_firebase> o query parameter ?token=<token>.'
    });
  }

  // Bypass opcional para testing local sin llamadas remotas a Firebase Auth
  if (process.env.NODE_ENV === 'test' && token.startsWith('mock-token-')) {
    if (token === 'mock-token-superadmin') {
      req.user = { email: 'admin@digitalagil.es', rol: 'Super Administrador' };
    } else {
      req.user = { email: 'recruiter@digitalagil.com', rol: 'Reclutador' };
    }
    return next();
  }

  try {
    // Verificación criptográfica contra Firebase Auth
    const decodedToken = await getAuth().verifyIdToken(token);
    req.user = decodedToken;  // Inyectar identidad verificada en la request
    next();
  } catch (error) {
    return res.status(403).json({
      status: 'error',
      code: 'TOKEN_INVALIDO',
      message: 'Token inválido o expirado. Renueva tu sesión de Firebase.',
      detail: error.message
    });
  }
};
