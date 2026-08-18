import { jest } from '@jest/globals';
import { validarSendGridSecret } from '../../src/middlewares/sendgridAuthMiddleware.js';
import { procesarInboundCV } from '../../src/controllers/webhooksController.js';

describe('Módulo Webhooks Inbound — Candidaturas Espontáneas SendGrid', () => {

  describe('Middleware de Seguridad: validarSendGridSecret', () => {
    test('Permite el paso en entorno test si el secret coincide con "mock-secret-test"', () => {
      const req = { query: { secret: 'mock-secret-test' } };
      let statusResult = null;
      const res = {
        status: (code) => {
          statusResult = code;
          return res;
        },
        json: () => res
      };
      const next = jest.fn();

      validarSendGridSecret(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(statusResult).toBeNull();
    });

    test('Rechaza la petición con HTTP 401 si el secret es incorrecto o ausente', () => {
      process.env.SENDGRID_INBOUND_WEBHOOK_SECRET = 'expected-secret-key';
      const req = { query: { secret: 'invalid-secret' }, ip: '127.0.0.1' };
      let statusResult = null;
      let jsonResult = null;
      const res = {
        status: (code) => {
          statusResult = code;
          return res;
        },
        json: (data) => {
          jsonResult = data;
          return res;
        }
      };
      const next = jest.fn();

      validarSendGridSecret(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(statusResult).toBe(401);
      expect(jsonResult.status).toBe('error');
    });
  });

  describe('Controlador: procesarInboundCV', () => {
    test('Devuelve HTTP 200 (status: "ignored") si el correo no tiene un adjunto CV válido', async () => {
      // Simular MIME sin adjuntos
      const rawMimeSinAdjunto = `From: Remitente <candidato@test.com>
Subject: Consulta sin CV
Content-Type: text/plain; charset=utf-8

Hola, estoy interesado en trabajar con ustedes.`;

      const req = { body: { email: rawMimeSinAdjunto } };
      let statusResult = null;
      let jsonResult = null;
      const res = {
        status: (code) => {
          statusResult = code;
          return res;
        },
        json: (data) => {
          jsonResult = data;
          return res;
        }
      };

      await procesarInboundCV(req, res);

      expect(statusResult).toBe(200);
      expect(jsonResult.status).toBe('ignored');
      expect(jsonResult.message).toContain('No se encontró ningún archivo CV válido');
    });

    test('Procesa exitosamente un MIME raw con adjunto PDF y fuerza origen "Email - Espontáneo" y estado "pendiente"', async () => {
      const rawMimeConCV = `From: Juan Perez <juan.perez@empresa.com>
Subject: Postulacion Espontánea
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="BOUNDARY123"

--BOUNDARY123
Content-Type: text/plain; charset=utf-8

Adjunto mi curriculum vitae.

--BOUNDARY123
Content-Type: application/pdf; name="CV_Juan_Perez.pdf"
Content-Disposition: attachment; filename="CV_Juan_Perez.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQKJSDi48nNCiAxIDAgb2JqCjw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+CmVuZG9iagoxIDAgb2JqCjw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+CmVuZG9iag==
--BOUNDARY123--`;

      const req = { body: { email: rawMimeConCV } };
      let statusResult = null;
      let jsonResult = null;
      const res = {
        status: (code) => {
          statusResult = code;
          return res;
        },
        json: (data) => {
          jsonResult = data;
          return res;
        }
      };

      await procesarInboundCV(req, res);

      expect(statusResult).toBe(201);
      expect(jsonResult.status).toBe('success');
      expect(jsonResult.data.origen).toBe('Email - Espontáneo');
      expect(jsonResult.data.estado_revision).toBe('pendiente');
      expect(jsonResult.data.canal_ingreso).toBe('Email');
      expect(jsonResult.data.url_cv).toMatch(/^gs:\/\//);
    });
  });

});
