/* VERSION v9 — gastronomico.js (otros remunerativos entran en la base de antigüedad, complemento y asistencia) */
/* =========================================================
   gastronomico.js
   MÓDULO INDEPENDIENTE de liquidación GASTRONÓMICA.
   Tiene su propia pantalla, su propio cálculo y su propio recibo.
   No usa nada de Rural, Metalúrgica ni Mensual.

   Reglas:
   - Total básico        = remuneración básica (manual) x días trabajados (manual)
   - Otros remunerativos = conceptos e importes cargados a mano
   - Base de cálculo     = total básico + otros remunerativos
   - Antigüedad          = % (manual) sobre la base de cálculo
   - Complemento servicio= 12% sobre la base de cálculo
   - Asistencia          = 10% sobre la base de cálculo
   - Total remunerativo  = base de cálculo + antigüedad + complemento + asistencia
   - No remunerativos    = conceptos e importes cargados a mano
   - Retenciones y contribuciones: % fijos sobre el total remunerativo (ver PARAM)
   - Riesgo de trabajo - FFEP y Seguro colectivo de vida obligatorio: importe manual
   Solo reutiliza la capa de datos (DB) para clientes, legajos y liquidaciones.
========================================================= */

const Gastronomico = (() => {

  /* ---------- Porcentajes fijos de esta categoría (se cambian solo acá) ---------- */
  const PARAM = {
    complementoServicioPct: 12,   // sobre total básico
    asistenciaPct: 10,            // sobre total básico
    retenciones: [                // todas sobre el total remunerativo
      { nombre: 'Jubilación', pct: 11 },
      { nombre: 'Ley 19.032', pct: 3 },
      { nombre: 'Obra Social', pct: 3 },
      { nombre: 'Obra Social diferencia jornada parcial', pct: 3 },
      { nombre: 'Cuota sindical', pct: 2.5 },
      { nombre: 'Seguro de vida y sepelio', pct: 1 }
    ],
    contribuciones: [             // todas sobre el total remunerativo
      { nombre: 'SIPA - Ley 24.241', pct: 10.77 },
      { nombre: 'Ley 19.032 - INSSJP', pct: 1.59 },
      { nombre: 'Obra Social', pct: 6 },
      { nombre: 'Obra Social diferencia jornada parcial', pct: 6 },
      { nombre: 'Asignaciones Familiares', pct: 4.7 },
      { nombre: 'Fondo Nacional de Empleo', pct: 0.94 },
      { nombre: 'Fondo convencional', pct: 2 },
      { nombre: 'Seguro de vida y sepelio', pct: 1 }
    ]
  };

  const $ = (id) => document.getElementById(id);
  const num = (v) => Number(v) || 0;
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const suma = (arr) => arr.reduce((a, b) => a + b, 0);
  const fmt = (n) => '$ ' + num(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fecha = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
  const mesAnio = (ym) => { if (!ym) return ''; const [y, m] = String(ym).split('-'); return `${m}/${y}`; };
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  let contexto = null;   // liquidación calculada pendiente de guardar
  let noRemCount = 0, remCount = 0;

  /* ---------- Número a letras (propio de este módulo) ---------- */
  function centenasALetras(n, apocope) {
    const UN = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce',
      'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno',
      'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
    const DE = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
    const CE = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
    if (n === 100) return 'cien';
    const c = Math.floor(n / 100), r = n % 100;
    let s = c ? CE[c] + ' ' : '';
    if (r < 30) { if (r) s += UN[r]; }
    else { const d = Math.floor(r / 10), u = r % 10; s += DE[d] + (u ? ' y ' + UN[u] : ''); }
    s = s.trim();
    return apocope ? s.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un') : s;
  }

  function aLetras(monto) {
    const entero = Math.floor(monto);
    const cent = Math.round((monto - entero) * 100);
    const millones = Math.floor(entero / 1000000);
    const miles = Math.floor((entero % 1000000) / 1000);
    const resto = entero % 1000;
    const partes = [];
    if (millones) partes.push(millones === 1 ? 'un millón' : centenasALetras(millones, true) + ' millones');
    if (miles) partes.push(miles === 1 ? 'mil' : centenasALetras(miles, true) + ' mil');
    if (resto) partes.push(centenasALetras(resto, false));
    return `${partes.join(' ') || 'cero'} con ${String(cent).padStart(2, '0')}/100`;
  }



  /* =========================================================
     CÁLCULO
     datos: { basico, diasTrabajados, antigPct, ffepImporte, seguroColectivoImporte,
              lugar, fechaPagoAportes, periodoDepositado,
              remAdicionales:[{concepto,importe}], noRemAdicionales:[{concepto,importe}] }
  ========================================================= */
  function calcular(d) {
    const basico = num(d.basico);
    const diasTrabajados = num(d.diasTrabajados);

    // Total básico = remuneración básica x días trabajados
    const totalBasico = r2(basico * diasTrabajados);

    // Otros conceptos remunerativos (manuales): suman al total remunerativo y también a la base de los % siguientes
    const remAdicionales = (d.remAdicionales || []).map(x => ({ concepto: x.concepto, importe: r2(num(x.importe)) }));
    const totalRemAdicionales = r2(suma(remAdicionales.map(x => x.importe)));
    const baseCalculo = r2(totalBasico + totalRemAdicionales);

    // Antigüedad: % manual sobre la base de cálculo (total básico + otros remunerativos)
    const antiguedadPct = num(d.antigPct);
    const antiguedadImporte = r2(baseCalculo * antiguedadPct / 100);

    // Complemento de servicio y asistencia: % fijos sobre la misma base de cálculo
    const complementoImporte = r2(baseCalculo * PARAM.complementoServicioPct / 100);
    const asistenciaImporte = r2(baseCalculo * PARAM.asistenciaPct / 100);

    const totalRemunerativo = r2(baseCalculo + antiguedadImporte + complementoImporte + asistenciaImporte);

    const noRemAdicionales = (d.noRemAdicionales || []).map(x => ({ concepto: x.concepto, importe: r2(num(x.importe)) }));
    const totalNoRemunerativo = r2(suma(noRemAdicionales.map(x => x.importe)));

    // Retenciones
    const descuentos = PARAM.retenciones.map(x => ({
      nombre: x.nombre, pct: x.pct, importe: r2(totalRemunerativo * x.pct / 100)
    }));
    const totalDescuentos = r2(suma(descuentos.map(x => x.importe)));
    const neto = r2(totalRemunerativo + totalNoRemunerativo - totalDescuentos);

    // Contribuciones aplicables (+ dos conceptos de importe manual, con unidad "1")
    const contribuciones = PARAM.contribuciones.map(x => ({
      nombre: x.nombre, pct: x.pct, importe: r2(totalRemunerativo * x.pct / 100)
    }));
    contribuciones.push({ nombre: 'Riesgo de trabajo - FFEP', pct: null, unidad: '1', importe: r2(num(d.ffepImporte)) });
    contribuciones.push({ nombre: 'Seguro colectivo de vida obligatorio', pct: null, unidad: '1', importe: r2(num(d.seguroColectivoImporte)) });
    const totalContribuciones = r2(suma(contribuciones.map(x => x.importe)));

    return {
      modoGastro: true,
      tipoLiquidacion: 'gastronomico',
      lugarPago: String(d.lugar || '').trim(),
      fechaPagoAportes: d.fechaPagoAportes || '',
      periodoDepositado: d.periodoDepositado || '',
      basico, diasTrabajados, totalBasico, totalRemAdicionales, baseCalculo,
      antiguedadPct, antiguedadImporte,
      complementoPct: PARAM.complementoServicioPct, complementoImporte,
      asistenciaPct: PARAM.asistenciaPct, asistenciaImporte,
      totalRemunerativo, remAdicionales, noRemAdicionales, totalNoRemunerativo,
      descuentos, totalDescuentos, neto,
      contribuciones, totalContribuciones
    };
  }

  /* =========================================================
     RECIBO (HTML propio de Gastronómico). Original = firma del empleado;
     duplicado = firma del empleador (solo se imprime).
  ========================================================= */
  function renderRecibos(cliente, legajo, ctx, r) {
    return renderRecibo(cliente, legajo, ctx, r, 'original') +
      `<div style="display:none">${renderRecibo(cliente, legajo, ctx, r, 'duplicado')}</div>`;
  }

  function renderRecibo(cliente, legajo, ctx, r, copia) {
    const esDuplicado = copia === 'duplicado';
    const v = '<td class="num"></td>';

    const filasRem = (r.remAdicionales || []).map(c => `<tr><td>${c.concepto}</td>${v}<td class="num">${fmt(c.importe)}</td>${v}${v}</tr>`).join('');
    const filasNoRem = r.noRemAdicionales.map(c => `<tr><td>${c.concepto}</td>${v}${v}<td class="num">${fmt(c.importe)}</td>${v}</tr>`).join('');
    const filasDesc = r.descuentos.map(x => `<tr><td>${x.nombre}</td><td class="num">${x.pct}%</td>${v}${v}<td class="num">${fmt(x.importe)}</td></tr>`).join('');
    const filasContrib = r.contribuciones.map(x =>
      `<tr><td>${x.nombre}</td><td class="num">${x.pct !== null && x.pct !== undefined ? x.pct + '%' : (x.unidad || '')}</td><td class="num">${fmt(x.importe)}</td></tr>`).join('');

    const bloqueFirma = esDuplicado
      ? `<div class="recibo-firma"><div class="linea"></div>Firma del empleador</div>`
      : `<div class="recibo-firma">
        <div class="linea"></div>
        Firma del empleado
        <p style="margin-top:14px; font-size:10px;">Recibí el importe de esta liquidación en pago de mi remuneración correspondiente al período indicado y duplicado de la misma conforme a la ley vigente.</p>
      </div>`;

    return `
    <div class="recibo recibo-gastro">
      <div class="recibo-copia">${esDuplicado ? 'DUPLICADO' : 'ORIGINAL'}</div>
      <div class="recibo-titulo">RECIBO DE HABERES LEY 20.744</div>
      <div class="recibo-empresa">
        <div class="razon">${cliente.razonSocial}</div>
        <div>C.U.I.T: ${cliente.cuit}</div>
        <div>${[cliente.domicilio, cliente.provincia].filter(Boolean).join(' - ')}</div>
      </div>
      <div class="recibo-grid cols-2">
        <div><div class="label">Período abonado</div><div class="valor">${ctx.periodoTexto}</div></div>
        <div><div class="label">Legajo N°</div><div class="valor">${legajo.legajo}</div></div>
      </div>
      <div class="recibo-grid cols-2">
        <div><div class="label">Apellido y nombre</div><div class="valor">${legajo.nombre}</div></div>
        <div><div class="label">C.U.I.L. empleado</div><div class="valor">${legajo.cuil}</div></div>
      </div>
      <div class="recibo-grid cols-3">
        <div><div class="label">Tipo de contrato</div><div class="valor">${legajo.tipoContrato || '—'}</div></div>
        <div><div class="label">Obra social</div><div class="valor">${legajo.obraSocial || '—'}</div></div>
        <div><div class="label">Remuneración básica</div><div class="valor">${fmt(r.basico)}</div></div>
      </div>
      <div class="recibo-grid cols-5" style="grid-template-columns:repeat(6,1fr)">
        <div><div class="label">Fecha ingreso</div><div class="valor">${fecha(legajo.fechaIngreso)}</div></div>
        <div><div class="label">Categoría</div><div class="valor">${legajo.categoria || '—'}</div></div>
        <div><div class="label">Tarea desempeñada</div><div class="valor">${legajo.tarea || '—'}</div></div>
        <div><div class="label">Fecha pago aportes</div><div class="valor">${fecha(r.fechaPagoAportes) || '—'}</div></div>
        <div><div class="label">Período depositado</div><div class="valor">${mesAnio(r.periodoDepositado) || '—'}</div></div>
        <div><div class="label">Banco</div><div class="valor">${legajo.banco || '—'}</div></div>
      </div>

      <table class="recibo-conceptos">
        <thead>
          <tr><th style="width:34%">Conceptos</th><th>Un.</th><th>Remunerativo</th><th>No remunerativo</th><th>Descuentos</th></tr>
        </thead>
        <tbody>
          <tr><td>Cantidad de días trabajados</td><td class="num">${r.diasTrabajados}</td><td class="num">${fmt(r.totalBasico)}</td>${v}${v}</tr>
          <tr><td>Antigüedad</td><td class="num">${r.antiguedadPct}%</td><td class="num">${fmt(r.antiguedadImporte)}</td>${v}${v}</tr>
          <tr><td>Complemento de servicio</td><td class="num">${r.complementoPct}%</td><td class="num">${fmt(r.complementoImporte)}</td>${v}${v}</tr>
          <tr><td>Asistencia</td><td class="num">${r.asistenciaPct}%</td><td class="num">${fmt(r.asistenciaImporte)}</td>${v}${v}</tr>
          ${filasRem}
          ${filasNoRem}
          ${filasDesc}
          <tr class="totales">
            <td>TOTALES</td><td></td>
            <td class="num">${fmt(r.totalRemunerativo)}</td>
            <td class="num">${fmt(r.totalNoRemunerativo)}</td>
            <td class="num">${fmt(r.totalDescuentos)}</td>
          </tr>
        </tbody>
      </table>

      <div class="recibo-neto">NETO A COBRAR &nbsp; ${fmt(r.neto)}</div>
      <div class="recibo-leyenda"><strong>Son pesos:</strong> ${aLetras(r.neto)}</div>

      <div class="recibo-contrib-title">Contribuciones aplicables</div>
      <table class="recibo-conceptos">
        <thead><tr><th style="width:50%">Concepto</th><th>Un.</th><th>Importe</th></tr></thead>
        <tbody>
          ${filasContrib}
          <tr class="totales"><td>TOTAL CONTRIBUCIONES</td><td></td><td class="num">${fmt(r.totalContribuciones)}</td></tr>
        </tbody>
      </table>

      ${bloqueFirma}
      <div class="recibo-pie">Lugar y fecha de pago: ${r.lugarPago || cliente.provincia || ''}, ${ctx.fechaPago ? fecha(ctx.fechaPago) : '—'}</div>
    </div>`;
  }

  /* =========================================================
     IMPRESIÓN A4: ORIGINAL y DUPLICADO, una hoja cada uno
  ========================================================= */
  const CSS_IMPRESION = `
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 9pt; line-height: 1.25; }
    .hoja-a4 { width: 190mm; height: 277mm; overflow: hidden; break-after: page; page-break-after: always; }
    .hoja-a4:last-child { break-after: auto; page-break-after: auto; }
    .recibo { width: 190mm; border: 1.5px solid #000; transform-origin: top left; }
    .recibo-copia { text-align: right; font-size: 8pt; font-weight: 700; letter-spacing: 1px; padding: 3px 8px; border-bottom: 1px solid #000; }
    .recibo-titulo { text-align: center; font-weight: 700; font-size: 12pt; padding: 6px; border-bottom: 1px solid #000; background: #e8e8e8; }
    .recibo-empresa { padding: 5px 8px; border-bottom: 1px solid #000; }
    .recibo-empresa .razon { font-weight: 700; font-size: 11pt; }
    .recibo-grid { display: table; table-layout: fixed; width: 100%; border-bottom: 1px solid #000; }
    .recibo-grid > div { display: table-cell; padding: 3px 7px; border-right: 1px solid #000; vertical-align: top; }
    .recibo-grid > div:last-child { border-right: 0; }
    .recibo-grid.cols-5 > div:nth-child(1) { width: 14%; }
    .recibo-grid.cols-5 > div:nth-child(2) { width: 14%; }
    .recibo-grid.cols-5 > div:nth-child(3) { width: 23%; }
    .recibo-grid.cols-5 > div:nth-child(4) { width: 18%; }
    .recibo-grid.cols-5 > div:nth-child(5) { width: 17%; }
    .recibo-grid.cols-5 > div:nth-child(6) { width: 14%; }
    .recibo-grid .label { font-size: 6.5pt; font-weight: 700; text-transform: uppercase; color: #333; }
    .recibo-grid .valor { font-size: 9pt; min-height: 11pt; }
    table.recibo-conceptos { width: 100%; border-collapse: collapse; }
    table.recibo-conceptos th, table.recibo-conceptos td { border: 1px solid #000; padding: 3px 6px; }
    table.recibo-conceptos thead th { background: #e8e8e8; font-size: 8pt; text-transform: uppercase; text-align: center; }
    table.recibo-conceptos td.num { text-align: right; white-space: nowrap; }
    table.recibo-conceptos tr.totales td { font-weight: 700; background: #f0f0f0; }
    table.recibo-conceptos tr:first-child th, table.recibo-conceptos thead tr th { border-top: 0; }
    table.recibo-conceptos th:first-child, table.recibo-conceptos td:first-child { border-left: 0; }
    table.recibo-conceptos th:last-child, table.recibo-conceptos td:last-child { border-right: 0; }
    .recibo-neto { text-align: right; font-weight: 700; font-size: 12pt; padding: 6px 10px; border-bottom: 1px solid #000; }
    .recibo-leyenda { padding: 5px 8px; border-bottom: 1px solid #000; }
    .recibo-contrib-title { font-weight: 700; text-transform: uppercase; font-size: 8.5pt; padding: 4px 8px; background: #e8e8e8; border-bottom: 1px solid #000; }
    .recibo-firma { text-align: center; padding: 14mm 15mm 4mm; font-size: 9pt; border-top: 1px solid #000; }
    .recibo-firma .linea { border-top: 1px solid #000; width: 75mm; margin: 0 auto 4px; }
    .recibo-pie { padding: 5px 8px; font-size: 8pt; border-top: 1px solid #000; }
  `;

  function imprimir() {
    const recibos = document.querySelectorAll('#gasReciboContainer .recibo-gastro');
    if (!recibos.length) return;

    const hojas = [...recibos].map(rec => `<div class="hoja-a4">${rec.outerHTML}</div>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recibo de haberes</title><style>${CSS_IMPRESION}</style></head><body>${hojas}</body></html>`;

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed; left:-10000px; top:0; width:210mm; height:297mm; border:0; visibility:hidden;';
    document.body.appendChild(iframe);
    const limpiar = () => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); };

    iframe.onload = () => {
      try {
        const doc = iframe.contentDocument;
        doc.querySelectorAll('.hoja-a4').forEach(hoja => {
          const rec = hoja.querySelector('.recibo');
          rec.style.width = '190mm';
          const escala = Math.min(1, hoja.clientHeight / rec.offsetHeight);
          if (escala < 1) {
            const s = Math.floor(escala * 100) / 100;
            rec.style.width = `calc(190mm / ${s})`;
            rec.style.transform = `scale(${s})`;
          }
        });
        iframe.contentWindow.onafterprint = limpiar;
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(limpiar, 120000);
      } catch (err) { limpiar(); mostrarErrorEnPantalla(err); }
    };
    iframe.srcdoc = html;
  }

  /* =========================================================
     PANTALLA
  ========================================================= */
  async function poblarClientes() {
    const sel = $('gasCliente');
    const actual = sel.value;
    const clientes = await DB.getClientes();
    sel.innerHTML = '<option value="">Seleccionar cliente...</option>' +
      clientes.map(c => `<option value="${c.id}">${c.razonSocial}</option>`).join('');
    sel.value = actual;
  }

  function ocultarFormulario() {
    $('gasFormCard').style.display = 'none';
    $('gasResultadoCard').style.display = 'none';
  }

  /** Vista previa en vivo de los conceptos remunerativos */
  function actualizarPreview() {
    const totalBasico = r2(num($('gasBasico').value) * num($('gasDias').value));
    const otros = r2(suma(leerFilas('gasListaRem').map(f => num(f.importe))));
    const base = r2(totalBasico + otros);   // base de antigüedad, complemento y asistencia
    const pct = num($('gasAntigPct').value);
    const antig = r2(base * pct / 100);
    const comp = r2(base * PARAM.complementoServicioPct / 100);
    const asis = r2(base * PARAM.asistenciaPct / 100);
    $('gasPreviewTexto').innerHTML =
      `Total básico: <strong>${fmt(totalBasico)}</strong>` +
      (otros ? ` · Otros remunerativos: <strong>${fmt(otros)}</strong> · Base de cálculo: <strong>${fmt(base)}</strong>` : '') + ` · ` +
      `Antigüedad (${pct}%): <strong>${fmt(antig)}</strong> · ` +
      `Complemento de servicio (${PARAM.complementoServicioPct}%): <strong>${fmt(comp)}</strong> · ` +
      `Asistencia (${PARAM.asistenciaPct}%): <strong>${fmt(asis)}</strong><br>` +
      `Total remunerativo: <strong>${fmt(r2(base + antig + comp + asis))}</strong>`;
  }

  /* ---- Conceptos manuales (remunerativos y no remunerativos): concepto + importe ---- */
  function agregarFila(contenedorId, tipo) {
    const idx = tipo === 'rem' ? remCount++ : noRemCount++;
    const rowId = `gas-${tipo}-${idx}`;
    const div = document.createElement('div');
    div.className = 'fila-concepto';
    div.id = 'fila-' + rowId;
    div.innerHTML = `
      <input class="input concepto-nombre" placeholder="Concepto">
      <input class="input concepto-importe" type="number" step="0.01" placeholder="Importe">
      <button class="btn-icon" title="Quitar" onclick="document.getElementById('fila-${rowId}').remove(); Gastronomico.refrescar()">✖</button>`;
    $(contenedorId).appendChild(div);
  }

  function leerFilas(contenedorId) {
    const out = [];
    document.querySelectorAll(`#${contenedorId} .fila-concepto`).forEach(f => {
      const concepto = f.querySelector('.concepto-nombre').value.trim();
      const importe = f.querySelector('.concepto-importe').value;
      if (concepto && importe) out.push({ concepto, importe });
    });
    return out;
  }

  async function calcularYMostrar() {
    try {
      const clienteId = $('gasCliente').value;
      const legajoId = $('gasLegajo').value;
      const periodo = $('gasPeriodo').value;
      const fechaPago = $('gasFechaRecibo').value;   // fecha manual del pie del recibo
      if (!clienteId || !legajoId || !periodo) { alert('Completá cliente, legajo y período antes de calcular.'); return; }

      const [cliente, legajo] = await Promise.all([DB.getCliente(clienteId), DB.getLegajo(legajoId)]);

      const resultado = calcular({
        basico: $('gasBasico').value,
        diasTrabajados: $('gasDias').value,
        antigPct: $('gasAntigPct').value,
        ffepImporte: $('gasFfep').value,
        seguroColectivoImporte: $('gasSeguroColectivo').value,
        lugar: $('gasLugar').value,
        fechaPagoAportes: $('gasFechaAportes').value,
        periodoDepositado: $('gasPeriodoDepositado').value,
        remAdicionales: leerFilas('gasListaRem'),
        noRemAdicionales: leerFilas('gasListaNoRem')
      });

      const [anio, mes] = periodo.split('-');
      contexto = {
        clienteId, legajoId, periodo,
        periodoTexto: `${MESES[parseInt(mes, 10) - 1].toUpperCase()} ${anio}`,
        fechaPago, tipoLiquidacion: 'gastronomico', resultado
      };

      $('gasReciboContainer').innerHTML = renderRecibos(cliente, legajo, contexto, resultado);
      $('btnGasGuardar').style.display = 'inline-block';
      $('gasResultadoCard').style.display = 'block';
      $('gasResultadoCard').scrollIntoView({ behavior: 'smooth' });
    } catch (err) { mostrarErrorEnPantalla(err); }
  }

  async function guardar() {
    if (!contexto) return;
    try {
      await DB.guardarLiquidacion(contexto);
      alert('Liquidación gastronómica guardada correctamente.');
      await renderHistorial();
      await actualizarDashboard();
    } catch (err) { mostrarErrorEnPantalla(err); }
  }

  async function renderHistorial() {
    try {
      const [liqs, clientes, legajos] = await Promise.all([DB.getLiquidaciones(), DB.getClientes(), DB.getLegajos()]);
      const propias = liqs.filter(l => l.resultado && l.resultado.modoGastro);
      const tbody = $('gasTablaHistorial');
      tbody.innerHTML = '';
      $('gasSinHistorial').style.display = propias.length ? 'none' : 'block';
      propias.forEach(l => {
        const cliente = clientes.find(c => c.id === l.clienteId);
        const legajo = legajos.find(x => x.id === l.legajoId);
        tbody.innerHTML += `<tr>
          <td>${l.periodoTexto}</td>
          <td>${cliente ? cliente.razonSocial : '—'}</td>
          <td>${legajo ? legajo.nombre : '—'}</td>
          <td>${fmt(l.resultado.neto)}</td>
          <td>
            <button class="btn-icon" title="Ver recibo" onclick="Gastronomico.verRecibo('${l.id}')">👁️</button>
            <button class="btn-icon" title="Anular" onclick="Gastronomico.anular('${l.id}')">🗑️</button>
          </td></tr>`;
      });
    } catch (err) { mostrarErrorEnPantalla(err); }
  }

  /** Muestra un recibo gastronómico ya guardado (también se llama desde el Inicio / historial general) */
  async function verRecibo(id) {
    try {
      const liqs = await DB.getLiquidaciones();
      const liq = liqs.find(l => l.id === id);
      if (!liq) return;
      const [cliente, legajo] = await Promise.all([DB.getCliente(liq.clienteId), DB.getLegajo(liq.legajoId)]);

      document.querySelectorAll('.menu-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.querySelector('[data-view="gastronomico"]').classList.add('active');
      $('view-gastronomico').classList.add('active');
      await poblarClientes();
      await renderHistorial();

      contexto = null;
      $('gasReciboContainer').innerHTML = renderRecibos(cliente, legajo, liq, liq.resultado);
      $('btnGasGuardar').style.display = 'none';
      $('gasFormCard').style.display = 'none';
      $('gasResultadoCard').style.display = 'block';
      $('gasResultadoCard').scrollIntoView({ behavior: 'smooth' });
    } catch (err) { mostrarErrorEnPantalla(err); }
  }

  async function anular(id) {
    if (!confirm('¿Anular esta liquidación? Es un comprobante legal: no se borra, queda marcada como anulada.')) return;
    try {
      await DB.eliminarLiquidacion(id);
      await renderHistorial();
      await actualizarDashboard();
    } catch (err) { mostrarErrorEnPantalla(err); }
  }

  /** Si el HTML todavía es una versión anterior, agrega acá el bloque "Otros conceptos remunerativos" */
  function asegurarBloqueRemunerativos() {
    if ($('gasListaRem')) return;
    const titulo = $('gasListaNoRem').previousElementSibling.previousElementSibling; // <h4> de "Conceptos no remunerativos"
    titulo.insertAdjacentHTML('beforebegin', `
        <h4>Otros conceptos remunerativos</h4>
        <p class="ayuda-texto">Cargá el nombre del concepto y su importe. Suman al total remunerativo (y a sus retenciones y contribuciones) y también modifican la antigüedad, el complemento de servicio y la asistencia.</p>
        <div id="gasListaRem" class="lista-dinamica"></div>
        <button class="btn-secondary btn-sm" id="btnGasAddRem">+ Agregar concepto remunerativo</button>`);
  }

  const VERSION = 'v9 · otros remunerativos entran en la base de antigüedad, complemento y asistencia';

  function init() {
    asegurarBloqueRemunerativos();
    const sub = document.querySelector('#view-gastronomico .view-header p');
    if (sub) sub.textContent += ' — ' + VERSION;
    $('gasCliente').addEventListener('change', async (e) => {
      const sel = $('gasLegajo');
      const legajos = e.target.value ? await DB.getLegajosPorCliente(e.target.value) : [];
      sel.innerHTML = '<option value="">Seleccionar legajo...</option>' +
        legajos.map(l => `<option value="${l.id}">${l.legajo} - ${l.nombre}</option>`).join('');
      sel.disabled = !e.target.value;
      ocultarFormulario();
    });

    $('gasLegajo').addEventListener('change', async (e) => {
      if (!e.target.value) { ocultarFormulario(); return; }
      const legajo = await DB.getLegajo(e.target.value);
      const cli = await DB.getCliente($('gasCliente').value);
      $('gasBasico').value = legajo.basico || '';
      $('gasLugar').value = (cli && cli.provincia) || '';
      $('gasListaNoRem').innerHTML = '';
      $('gasListaRem').innerHTML = '';
      agregarFila('gasListaRem', 'rem');   // fila lista para cargar concepto + importe
      actualizarPreview();
      $('gasFormCard').style.display = 'block';
      $('gasResultadoCard').style.display = 'none';
    });

    ['gasBasico', 'gasDias', 'gasAntigPct'].forEach(id => $(id).addEventListener('input', actualizarPreview));

    $('btnGasAddRem').addEventListener('click', () => agregarFila('gasListaRem', 'rem'));
    $('btnGasAddNoRem').addEventListener('click', () => agregarFila('gasListaNoRem', 'norem'));
    $('gasListaRem').addEventListener('input', actualizarPreview);
    $('btnGasCalcular').addEventListener('click', calcularYMostrar);
    $('btnGasGuardar').addEventListener('click', guardar);
    $('btnGasImprimir').addEventListener('click', imprimir);

    // Al entrar a la pantalla se cargan clientes e historial
    document.querySelector('[data-view="gastronomico"]').addEventListener('click', async () => {
      await poblarClientes();
      await renderHistorial();
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return { calcular, verRecibo, anular, refrescar: actualizarPreview, PARAM, _renderRecibos: renderRecibos, _CSS: CSS_IMPRESION };
})();