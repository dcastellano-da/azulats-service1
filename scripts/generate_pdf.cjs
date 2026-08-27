const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const mdPath = path.join(__dirname, '../docs/explicacion_usuarios_servicio_backend.md');
const htmlPath = '/tmp/explicacion_usuarios_servicio_backend.html';
const pdfPath = path.join(__dirname, '../docs/explicacion_usuarios_servicio_backend.pdf');

let mdContent = fs.readFileSync(mdPath, 'utf8');

// Replace TeX formula with styled math block for offline rendering compatibility
mdContent = mdContent.replace(
  /\$\$\\text\{Fit Score\} = \\sum \\text\{Puntaje Obtenido en Criterios Deseables\}\$\$/g,
  '<div class="math-card"><strong>Fit Score</strong> = ∑ (Puntaje Obtenido en Criterios Deseables)</div>'
);

const parsedHtml = marked.parse(mdContent);

const fullHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Manual y Explicación Funcional para Usuarios Finales – ATS Azul</title>
  <style>
    @page {
      size: A4;
      margin: 16mm 14mm 16mm 14mm;
    }
    @media print {
      body {
        -webkit-print-color-adjust: exact;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 11.5px;
      line-height: 1.5;
      color: #1e293b;
      background: #ffffff;
      margin: 0;
      padding: 0;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 2px solid #2563eb;
      padding-bottom: 8px;
      margin-top: 0;
      margin-bottom: 14px;
    }
    h2 {
      font-size: 15px;
      font-weight: 600;
      color: #1e293b;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 4px;
      margin-top: 20px;
      margin-bottom: 10px;
      page-break-after: avoid;
    }
    h3 {
      font-size: 13.5px;
      font-weight: 600;
      color: #334155;
      margin-top: 14px;
      margin-bottom: 6px;
      page-break-after: avoid;
    }
    h4 {
      font-size: 12.5px;
      font-weight: 600;
      color: #475569;
      margin-top: 12px;
      margin-bottom: 4px;
      page-break-after: avoid;
    }
    p {
      margin-top: 0;
      margin-bottom: 8px;
    }
    ul, ol {
      margin-top: 0;
      margin-bottom: 8px;
      padding-left: 20px;
    }
    li {
      margin-bottom: 3px;
    }
    hr {
      border: 0;
      border-top: 1px solid #e2e8f0;
      margin: 16px 0;
    }
    pre {
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
      font-size: 9.5px;
      line-height: 1.25;
      background-color: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 10px 12px;
      overflow-x: auto;
      white-space: pre;
      word-wrap: normal;
      margin-top: 8px;
      margin-bottom: 12px;
      page-break-inside: avoid;
    }
    code {
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
      font-size: 11px;
      background-color: #f1f5f9;
      color: #0f172a;
      padding: 2px 4px;
      border-radius: 4px;
    }
    pre code {
      background-color: transparent;
      padding: 0;
      font-size: inherit;
      color: inherit;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      margin-bottom: 14px;
      font-size: 11.5px;
      page-break-inside: avoid;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 6px 9px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background-color: #f1f5f9;
      font-weight: 600;
      color: #0f172a;
    }
    tr:nth-child(even) {
      background-color: #f8fafc;
    }
    blockquote {
      margin: 10px 0;
      padding: 8px 12px;
      color: #1e293b;
      background-color: #eff6ff;
      border-left: 4px solid #2563eb;
      border-radius: 0 6px 6px 0;
      font-size: 11.5px;
      page-break-inside: avoid;
    }
    blockquote p {
      margin: 0;
    }
    .math-card {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-left: 4px solid #16a34a;
      padding: 8px 14px;
      border-radius: 0 6px 6px 0;
      font-size: 12px;
      color: #14532d;
      margin: 12px 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      page-break-inside: avoid;
    }
    a {
      color: #2563eb;
      text-decoration: none;
    }
    strong {
      color: #0f172a;
    }
  </style>
</head>
<body>
  ${parsedHtml}
</body>
</html>`;

fs.writeFileSync(htmlPath, fullHtml, 'utf8');
console.log('HTML generated successfully at', htmlPath);
