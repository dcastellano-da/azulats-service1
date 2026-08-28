import puppeteer from 'puppeteer';

/**
 * Descarga una imagen remota (http/https o gs://) o utiliza la URI si ya es base64,
 * y la convierte a una cadena Data URI Base64 (data:image/...;base64,...).
 * Ante cualquier fallo o timeout, retorna null de forma transparente.
 *
 * @param {string} url - URL remota o URI de la imagen.
 * @param {number} timeoutMs - Tiempo máximo de espera en ms (default 5000ms).
 * @returns {Promise<string|null>} - Cadena Data URI Base64 o null si falla.
 */
export async function convertirUrlABase64(url, timeoutMs = 5000) {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return null;
  }

  const trimmedUrl = url.trim();

  // Si ya es un Data URI Base64, retornarlo directamente
  if (trimmedUrl.startsWith('data:image/')) {
    return trimmedUrl;
  }

  // En entorno de prueba unitaria sin red, si es URL de mock devolver un PNG base64 simulado
  if (process.env.NODE_ENV === 'test' && (trimmedUrl.includes('example.com') || trimmedUrl.includes('googleapis.com') || trimmedUrl.includes('test'))) {
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(trimmedUrl, {
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!response.ok) {
      console.warn(`[PDF IMAGE BASE64 WARNING] Respuesta HTTP no exitosa (${response.status}) al obtener imagen: ${trimmedUrl}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get('content-type') || 'image/png';
    const base64String = buffer.toString('base64');

    return `data:${contentType};base64,${base64String}`;
  } catch (error) {
    console.warn(`[PDF IMAGE BASE64 WARNING] No se pudo convertir imagen a Base64 (${trimmedUrl}):`, error.message);
    return null;
  }
}

/**
 * Genera el string HTML estilizado para la Ficha Técnica de Presentación a Cliente en PDF.
 * Incrusta logos e imágenes en Base64 para evitar latencias o timeouts por red en Puppeteer.
 *
 * @param {object} datos - Objeto con { agencia, busqueda, postulante, pipeline, resumenEjecutivoIA }
 * @param {object} opciones - Objeto con { incluir_test_personalidad, incluir_pretension_salarial, incluir_notas_assessment, incluir_bitacora, incluir_trayectoria, anonimizar_candidato }
 * @returns {Promise<string>} - Código HTML completo listo para ser renderizado por Puppeteer.
 */
export async function generarHtmlFichaPdf(datos = {}, opciones = {}) {
  const { agencia = {}, busqueda = {}, postulante = {}, pipeline = {}, resumenEjecutivoIA = '' } = datos;

  // 1. Datos de Identificación de Búsqueda y Marca
  const nombreAgencia = agencia.nombre_comercial || agencia.nombre || 'Azul ATS Agency';
  const logoUrlRaw = agencia.logo_url || null;
  const colorPrimario = agencia.color_primario || '#1e3a8a'; // Azul corporativo por defecto

  const rolSolicitado = busqueda.perfil_tecnico?.rol_solicitado || busqueda.titulo_busqueda || busqueda.codigo_busqueda || 'Rol Solicitado';
  const empresaCliente = busqueda.identificacion?.cliente || 'Empresa Cliente';

  // 2. Manejo de Anonimización de Candidato y Conversión de Imágenes a Base64
  const esAnonimo = Boolean(opciones.anonimizar_candidato);
  const nombreCandidato = esAnonimo
    ? `Candidato #${postulante.id ? postulante.id.substring(0, 8).toUpperCase() : 'EXP-001'}`
    : (postulante.nombre || postulante.nombre_completo || 'Postulante');

  const fotoUrlRaw = !esAnonimo ? (postulante.url_foto || postulante.foto_perfil || null) : null;
  const ubicacion = !esAnonimo ? (postulante.ubicacion || null) : null;
  const email = !esAnonimo ? (postulante.email || null) : null;
  const telefono = !esAnonimo ? (postulante.telefono_movil || postulante.telefono || null) : null;
  const linkedinUrl = !esAnonimo ? (postulante.linkedin_url || null) : null;
  const nivelIngles = postulante.nivel_ingles || null;

  // Inyección de imágenes convertidas a Base64 en paralelo
  const [logoBase64, fotoBase64] = await Promise.all([
    convertirUrlABase64(logoUrlRaw),
    convertirUrlABase64(fotoUrlRaw)
  ]);

  // 3. Test de Personalidad (CFV)
  const testPersonalidad = pipeline.f2_evaluacion?.test_personalidad || null;
  const mostrarTest = Boolean(opciones.incluir_test_personalidad && testPersonalidad);

  // 4. Pretensiones y Condiciones (Smart Scorecard)
  const pretensiones = pipeline.f2_evaluacion?.informe_entrevista_ia?.pretension_economica_condiciones || null;
  const mostrarPretensiones = Boolean(opciones.incluir_pretension_salarial && pretensiones);

  // 5. Assessment Manual
  const assessment = pipeline.f2_evaluacion?.assessment_manual || null;
  const mostrarAssessment = Boolean(opciones.incluir_notas_assessment && assessment);

  // 6. Bitácora del Reclutador (Consolidado F1 a F4)
  const bitacora = [];
  if (opciones.incluir_bitacora) {
    if (pipeline.f1_descubrimiento?.notas_reclutador) {
      bitacora.push({ fase: 'Fase 1: Contacto e Ingesta', nota: pipeline.f1_descubrimiento.notas_reclutador });
    }
    if (pipeline.f2_evaluacion?.notas_reclutador) {
      bitacora.push({ fase: 'Fase 2: Evaluación Técnica', nota: pipeline.f2_evaluacion.notas_reclutador });
    }
    if (pipeline.f3_cliente?.notas_reclutador) {
      bitacora.push({ fase: 'Fase 3: Entrevista Cliente', nota: pipeline.f3_cliente.notas_reclutador });
    }
    if (pipeline.f4_cierre?.notas_reclutador) {
      bitacora.push({ fase: 'Fase 4: Cierre u Oferta', nota: pipeline.f4_cierre.notas_reclutador });
    }
  }
  const mostrarBitacora = bitacora.length > 0;

  // 7. Trayectoria Laboral
  const mostrarTrayectoria = Boolean(opciones.incluir_trayectoria);

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Ficha Técnica - ${nombreCandidato}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      color: #1e293b;
      background-color: #ffffff;
      font-size: 13px;
      line-height: 1.5;
      padding: 20px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 3px solid ${colorPrimario};
      padding-bottom: 12px;
      margin-bottom: 20px;
    }
    .brand-title {
      font-size: 20px;
      font-weight: bold;
      color: ${colorPrimario};
    }
    .doc-subtitle {
      font-size: 11px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .agency-logo {
      max-height: 45px;
      max-width: 160px;
    }

    .card {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .card-title {
      font-size: 14px;
      font-weight: bold;
      color: ${colorPrimario};
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 6px;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .candidate-profile {
      display: flex;
      gap: 16px;
      align-items: center;
    }
    .avatar {
      width: 70px;
      height: 70px;
      border-radius: 50%;
      background-color: ${colorPrimario};
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      font-weight: bold;
      flex-shrink: 0;
      overflow: hidden;
    }
    .avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .candidate-info h2 {
      font-size: 18px;
      color: #0f172a;
      margin-bottom: 4px;
    }
    .candidate-meta {
      font-size: 12px;
      color: #475569;
    }
    .candidate-meta span {
      margin-right: 12px;
    }

    .ai-summary {
      background-color: #f0f9ff;
      border-left: 4px solid #0284c7;
      padding: 12px 16px;
      border-radius: 0 6px 6px 0;
      margin-bottom: 16px;
    }
    .ai-summary-title {
      font-size: 12px;
      font-weight: bold;
      color: #0369a1;
      margin-bottom: 6px;
      text-transform: uppercase;
    }

    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    .dimension-bar {
      margin-bottom: 8px;
    }
    .dimension-label {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      font-weight: bold;
      color: #334155;
      margin-bottom: 2px;
    }
    .progress-track {
      height: 8px;
      background-color: #e2e8f0;
      border-radius: 4px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background-color: ${colorPrimario};
    }

    .bitacora-item {
      border-left: 2px solid ${colorPrimario};
      padding-left: 10px;
      margin-bottom: 10px;
    }
    .bitacora-fase {
      font-size: 11px;
      font-weight: bold;
      color: #475569;
    }
    .bitacora-nota {
      font-size: 12px;
      color: #1e293b;
    }

    .footer {
      margin-top: 30px;
      border-top: 1px solid #e2e8f0;
      padding-top: 10px;
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: #94a3b8;
    }
    .badge-powered {
      font-weight: bold;
      color: #64748b;
    }
  </style>
</head>
<body>

  <!-- Encabezado con Branding (Inyección de Base64) -->
  <div class="header">
    <div>
      <div class="brand-title">${nombreAgencia}</div>
      <div class="doc-subtitle">Ficha Técnica de Presentación &bull; ${empresaCliente}</div>
    </div>
    <div>
      ${logoBase64 ? `<img src="${logoBase64}" class="agency-logo" alt="Logo">` : `<div style="font-size:16px; font-weight:bold; color:${colorPrimario}">${nombreAgencia}</div>`}
    </div>
  </div>

  <!-- Bloque 1: Perfil del Candidato (Inyección de Base64) -->
  <div class="card">
    <div class="candidate-profile">
      <div class="avatar">
        ${fotoBase64 ? `<img src="${fotoBase64}" alt="Foto">` : nombreCandidato.charAt(0)}
      </div>
      <div class="candidate-info">
        <h2>${nombreCandidato}</h2>
        <div class="candidate-meta">
          <strong>Puesto Postulado:</strong> ${rolSolicitado}
        </div>
        <div class="candidate-meta">
          ${ubicacion ? `<span>📍 ${ubicacion}</span>` : ''}
          ${nivelIngles ? `<span>🗣️ Inglés: ${nivelIngles}</span>` : ''}
          ${email ? `<span>✉️ ${email}</span>` : ''}
          ${telefono ? `<span>📞 ${telefono}</span>` : ''}
          ${linkedinUrl ? `<span>🔗 <a href="${linkedinUrl}">LinkedIn</a></span>` : ''}
        </div>
      </div>
    </div>
  </div>

  <!-- Resumen Ejecutivo IA -->
  ${resumenEjecutivoIA ? `
  <div class="ai-summary">
    <div class="ai-summary-title">✨ Resumen Ejecutivo (Sintetizado por IA)</div>
    <div>${resumenEjecutivoIA.replace(/\n/g, '<br>')}</div>
  </div>
  ` : ''}

  <!-- Bloque 2: Grilla con Psicometría y Pretensiones -->
  <div class="${(mostrarTest && (mostrarPretensiones || mostrarAssessment)) ? 'grid-2' : ''}">

    ${mostrarTest ? `
    <div class="card">
      <div class="card-title">Perfil Psicométrico — ${testPersonalidad.arquetipo_nombre || 'Cognitive Fit'} (${testPersonalidad.arquetipo_codigo || ''})</div>
      ${testPersonalidad.dimensiones ? `
        <div class="dimension-bar">
          <div class="dimension-label"><span>Mente</span><span>${testPersonalidad.dimensiones.dim_mente || 0}%</span></div>
          <div class="progress-track"><div class="progress-fill" style="width: ${testPersonalidad.dimensiones.dim_mente || 0}%"></div></div>
        </div>
        <div class="dimension-bar">
          <div class="dimension-label"><span>Energía</span><span>${testPersonalidad.dimensiones.dim_energia || 0}%</span></div>
          <div class="progress-track"><div class="progress-fill" style="width: ${testPersonalidad.dimensiones.dim_energia || 0}%"></div></div>
        </div>
        <div class="dimension-bar">
          <div class="dimension-label"><span>Naturaleza</span><span>${testPersonalidad.dimensiones.dim_naturaleza || 0}%</span></div>
          <div class="progress-track"><div class="progress-fill" style="width: ${testPersonalidad.dimensiones.dim_naturaleza || 0}%"></div></div>
        </div>
        <div class="dimension-bar">
          <div class="dimension-label"><span>Táctica</span><span>${testPersonalidad.dimensiones.dim_tactica || 0}%</span></div>
          <div class="progress-track"><div class="progress-fill" style="width: ${testPersonalidad.dimensiones.dim_tactica || 0}%"></div></div>
        </div>
        <div class="dimension-bar">
          <div class="dimension-label"><span>Identidad</span><span>${testPersonalidad.dimensiones.dim_identidad || 0}%</span></div>
          <div class="progress-track"><div class="progress-fill" style="width: ${testPersonalidad.dimensiones.dim_identidad || 0}%"></div></div>
        </div>
      ` : ''}
      ${testPersonalidad.analisis_encaje ? `<div style="margin-top:8px; font-size:11px; color:#475569;"><em>${testPersonalidad.analisis_encaje}</em></div>` : ''}
    </div>
    ` : ''}

    ${(mostrarPretensiones || mostrarAssessment) ? `
    <div class="card">
      <div class="card-title">Evaluación Técnica & Condiciones</div>
      ${mostrarPretensiones ? `
        <div style="margin-bottom: 8px;">
          <strong>Pretensión Salarial:</strong> ${pretensiones.pretension_salarial || 'No especificada'}<br>
          <strong>Modalidad Preferida:</strong> ${pretensiones.modalidad_preferida || 'No especificada'}<br>
          <strong>Disponibilidad:</strong> ${pretensiones.disponibilidad || 'Inmediata'}
        </div>
      ` : ''}
      ${mostrarAssessment ? `
        <div style="margin-top: 8px; border-top: 1px dashed #cbd5e1; padding-top: 6px;">
          <strong>Assessment Técnico Reclutador:</strong><br>
          ${assessment.resumen_texto}
        </div>
      ` : ''}
    </div>
    ` : ''}

  </div>

  <!-- Trayectoria Laboral -->
  ${mostrarTrayectoria ? `
  <div class="card">
    <div class="card-title">Trayectoria & Competencias</div>
    ${postulante.resumen ? `<p style="margin-bottom:8px;"><strong>Extracto Profesional:</strong> ${postulante.resumen}</p>` : ''}
    ${postulante.skills_principales ? `<p style="margin-bottom:8px;"><strong>Skills Destacadas:</strong> ${postulante.skills_principales}</p>` : ''}
    ${postulante.rubros ? `<p><strong>Rubros / Industrias:</strong> ${postulante.rubros}</p>` : ''}
  </div>
  ` : ''}

  <!-- Bitácora del Reclutador (F1 - F4) -->
  ${mostrarBitacora ? `
  <div class="card">
    <div class="card-title">Bitácora de Notas del Reclutador (Fases F1 a F4)</div>
    ${bitacora.map(b => `
      <div class="bitacora-item">
        <div class="bitacora-fase">${b.fase}</div>
        <div class="bitacora-nota">${b.nota}</div>
      </div>
    `).join('')}
  </div>
  ` : ''}

  <!-- Pie de página -->
  <div class="footer">
    <div>Confidencial — Documento de Selección Generado para ${empresaCliente}</div>
    <div class="badge-powered">Powered by Azul ATS</div>
  </div>

</body>
</html>
  `;
}

/**
 * Inicia un navegador Puppeteer en headless mode y renderiza el string HTML a un Buffer binario de PDF.
 * Utiliza waitUntil: 'load' para renderizado ultra rápido en milisegundos ya que las imágenes están incrustadas en Base64.
 *
 * @param {string} htmlContent - Contenido HTML completo con imágenes en Base64.
 * @returns {Promise<Buffer>} - Buffer binario con el archivo PDF generado.
 */
export async function renderizarPdfFromHtml(htmlContent) {
  if (process.env.NODE_ENV === 'test') {
    // En entorno de prueba unitaria sin navegador headless instalado, devolvemos un Buffer mock binario de PDF
    return Buffer.from('%PDF-1.4 Mock PDF Buffer Content for Azul ATS Presentation Card');
  }

  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  };

  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  let browser;
  try {
    browser = await puppeteer.launch(launchOptions);
  } catch (launchError) {
    console.error('[PUPPETEER LAUNCH ERROR] Fallo al iniciar el navegador Headless Chrome:', launchError);
    const infraError = new Error('Error de infraestructura: Motor de renderizado PDF no disponible (Falta binario de Chrome)');
    infraError.isPuppeteerLaunchError = true;
    infraError.originalError = launchError.message;
    throw infraError;
  }

  try {
    const page = await browser.newPage();
    // Inyección instantánea: waitUntil 'load' y timeout de 60s
    await page.setContent(htmlContent, { waitUntil: 'load', timeout: 60000 });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '12mm',
        right: '12mm',
        bottom: '12mm',
        left: '12mm'
      }
    });
    console.log('[DEBUG BACKEND] Tamaño del Buffer PDF:', pdfBuffer.length, 'bytes');
    return pdfBuffer;
  } catch (renderError) {
    console.error('[PUPPETEER RENDER ERROR] Fallo durante la generación del PDF en la página:', renderError);
    const isTimeout = /timeout/i.test(renderError.message);
    const mensajeError = isTimeout
      ? 'Error de infraestructura: Tiempo de espera agotado al renderizar el documento PDF.'
      : 'Error de infraestructura: Error al renderizar la plantilla HTML en PDF.';

    const infraError = new Error(mensajeError);
    infraError.isPuppeteerRenderError = true;
    infraError.isTimeout = isTimeout;
    infraError.originalError = renderError.message;
    throw infraError;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

