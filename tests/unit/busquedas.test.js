import { crearBusqueda } from '../../src/controllers/busquedasController.js';
import { esIdValido } from '../../scripts/migrar-busquedas-ids.js';

describe('Módulo de Búsquedas — Refactorización de IDs y Validaciones', () => {
  describe('esIdValido (Regex validation)', () => {
    test('Acepta IDs alfanuméricos autogenerados de 20 caracteres', () => {
      expect(esIdValido('aB1cD2eF3gH4iJ5kL6mN')).toBe(true);
      expect(esIdValido('1234567890abcdefghij')).toBe(true);
    });

    test('Acepta UUID v4 limpios', () => {
      expect(esIdValido('c4a938b8-4c12-4217-a068-967a57a58b29')).toBe(true);
      expect(esIdValido('C4A938B8-4C12-4217-A068-967A57A58B29')).toBe(true);
    });

    test('Rechaza IDs malformados (con espacios, guiones o texto legible)', () => {
      expect(esIdValido('ANALISTA ADMINISTRATIVO')).toBe(false);
      expect(esIdValido('11-')).toBe(false);
      expect(esIdValido('REQ-MOCK-001')).toBe(false);
      expect(esIdValido('corto')).toBe(false);
    });
  });

  describe('crearBusqueda controller', () => {
    test('Guarda el código ingresado en codigo_busqueda y asigna un id_busqueda autogenerado', async () => {
      const req = {
        body: {
          id_busqueda: 'ANALISTA ADMINISTRATIVO',
          identificacion: { cliente: 'Empresa Test' },
          perfil_tecnico: { rol_solicitado: 'Desarrollador' },
          estado_sla: { estado_busqueda: 'Abierta' }
        }
      };

      let jsonResult;
      let statusResult;
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

      await crearBusqueda(req, res);

      expect(statusResult).toBe(201);
      expect(jsonResult.status).toBe('success');
      expect(jsonResult.data.codigo_busqueda).toBe('ANALISTA ADMINISTRATIVO');
      expect(jsonResult.data.id_busqueda).not.toBe('ANALISTA ADMINISTRATIVO');
      expect(esIdValido(jsonResult.data.id_busqueda)).toBe(true);
    });
  });
});
