// jest.config.js
// Configuración de Jest para compatibilidad con ES Modules nativos.
// El proyecto usa "type": "module" en package.json, por lo que Node.js
// ya trata todos los .js como ESM automáticamente.
// No se declara extensionsToTreatAsEsm para .js (lo infiere el runtime).
export default {
  testEnvironment: 'node',
  transform: {},             // Sin transformaciones: usar ESM nativo de Node.js
  testMatch: [
    '**/tests/unit/**/*.test.js'
  ],
  verbose: true
};
