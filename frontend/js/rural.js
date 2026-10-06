/* =========================================================
   rural.js
   MÓDULO INDEPENDIENTE de liquidación RURAL.
   Tiene su propia pantalla, su propio cálculo y su propio recibo.
   No usa nada de Metalúrgica, Mensual ni Gastronómico.

   Reglas (las mismas que tenía Rural en la liquidación general):
   - Básico = jornal (tarifa diaria) x días trabajados
   - Feriados = días x jornal
   - Antigüedad = % sobre (básico por días + feriados), o importe manual
   - Presentismo = % sobre el básico por días
   - Aportes y contribuciones: se leen de "Configuración" (DB.getConfig)
   - ANSSAL/FSR y Contribución Obra Social: se elige el % al liquidar
   - FFEP: importe manual
   Solo reutiliza la capa de datos (DB) para clientes, legajos y liquidaciones.
========================================================= */

const Rural = (() => {

  const $ = (id) => document.getElementById(id);
  const num = (v) => Number(v) || 0;
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const suma = (arr) => arr.reduce((a, b) => a + b, 0);
  const fmt = (n) => '$ ' + num(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fecha = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  let contexto = null;       // liquidación calculada pendiente de guardar
  let remCount = 0, noRemCount = 0, feriadoCount = 0;

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
     datos: { basico (jornal), diasTrabajados, feriados:[{dias}],
              antigModo:'automatico'|'manual', antigPct, antigManualImporte,
              presentismoPct, aCuenta, anssalFsrPct, obraSocialContribPct, ffepImporte,
              remAdicionales:[{concepto,importe}], noRemAdicionales:[{concepto,importe}] }
  ========================================================= */
  function calcular(d) {
    const config = DB.getConfig();
    const basico = num(d.basico);
    const diasTrabajados = num(d.diasTrabajados);

    // Básico = jornal x días
    const basicoImporte = r2(basico * diasTrabajados);

    // Feriados: cada fila = días x jornal
    const feriados = (d.feriados || []).map(f => ({ dias: num(f.dias), importe: r2(num(f.dias) * basico) }));
    const totalFeriados = r2(suma(feriados.map(f => f.importe)));

    // Antigüedad
    let antiguedadImporte, antiguedadDetalle;
    if (d.antigModo === 'manual') {
      antiguedadImporte = r2(num(d.antigManualImporte));
      antiguedadDetalle = 'Importe manual';
    } else {
      const pct = num(d.antigPct);
      antiguedadImporte = r2((basicoImporte + totalFeriados) * pct / 100);
      antiguedadDetalle = pct + '%';
    }

    const presentismoImporte = r2(basicoImporte * num(d.presentismoPct) / 100);
    const aCuenta = num(d.aCuenta);

    const remAdicionales = (d.remAdicionales || []).map(x => ({ concepto: x.concepto, importe: r2(num(x.importe)) }));
    const noRemAdicionales = (d.noRemAdicionales || []).map(x => ({ concepto: x.concepto, importe: r2(num(x.importe)) }));

    const totalRemunerativo = r2(basicoImporte + antiguedadImporte + presentismoImporte + aCuenta +
      totalFeriados + suma(remAdicionales.map(x => x.importe)));
    const totalNoRemunerativo = r2(suma(noRemAdicionales.map(x => x.importe)));

    // Aportes del empleado (porcentajes de Configuración)
    const descuentos = config.aportes.map(a => ({
      id: a.id, nombre: a.nombre, pct: a.pct, importe: r2(totalRemunerativo * a.pct / 100)
    }));
    const totalDescuentos = r2(suma(descuentos.map(x => x.importe)));
    const neto = r2(totalRemunerativo + totalNoRemunerativo - totalDescuentos);

    // Contribuciones patronales (Configuración; ANSSAL y Obra Social con % elegido al liquidar)
    const contribuciones = config.contribuciones.map(c => {
      let pct = c.pct;
      if (c.id === 'anssalFsr' && d.anssalFsrPct !== undefined && d.anssalFsrPct !== '') pct = Number(d.anssalFsrPct);
      if (c.id === 'obraSocialContrib' && d.obraSocialContribPct !== undefined && d.obraSocialContribPct !== '') pct = Number(d.obraSocialContribPct);
      return { id: c.id, nombre: c.nombre, pct, importe: r2(totalRemunerativo * pct / 100) };
    });
    const ffepImporte = r2(num(d.ffepImporte));
    if (ffepImporte > 0) contribuciones.push({ id: 'ffep', nombre: 'FFEP', pct: null, importe: ffepImporte });
    const totalContribuciones = r2(suma(contribuciones.map(x => x.importe)));

    return {
      modoRural: true,
      tipoLiquidacion: 'rural',
      basico, diasTrabajados, basicoImporte,
      feriados, totalFeriados,
      antiguedadImporte, antiguedadDetalle,
      presentismoImporte, aCuenta,
      remAdicionales, noRemAdicionales,
      totalRemunerativo, totalNoRemunerativo,
      descuentos, totalDescuentos, neto,
      contribuciones, totalContribuciones,
      totalCargasSociales: r2(totalDescuentos + totalContribuciones)
    };
  }

  /* =========================================================
     RECIBO (HTML propio de Rural). Original = firma del empleado;
     duplicado = firma del empleador (solo se imprime).
  ========================================================= */
  function renderRecibos(cliente, legajo, ctx, r, editable) {
    return renderRecibo(cliente, legajo, ctx, r, 'original', editable) +
      `<div style="display:none">${renderRecibo(cliente, legajo, ctx, r, 'duplicado', false)}</div>`;
  }

  function renderRecibo(cliente, legajo, ctx, r, copia, editable) {
    const esDuplicado = copia === 'duplicado';
    const v = '<td class="num"></td>';

    const filasBasico = `
          <tr><td>Básico (tarifa diaria)</td><td class="num">${fmt(r.basico)} / día</td>${v}${v}${v}</tr>
          <tr><td>Cantidad de días trabajados</td><td class="num">${r.diasTrabajados}</td><td class="num">${fmt(r.basicoImporte)}</td>${v}${v}</tr>`;
    const filasFeriados = (r.feriados || []).map(f =>
      `<tr><td>Feriados trabajados</td><td class="num">${f.dias}</td><td class="num">${fmt(f.importe)}</td>${v}${v}</tr>`).join('');
    const filasRem = r.remAdicionales.map(c => `<tr><td>${c.concepto}</td>${v}<td class="num">${fmt(c.importe)}</td>${v}${v}</tr>`).join('');
    const filasNoRem = r.noRemAdicionales.map(c => `<tr><td>${c.concepto}</td>${v}${v}<td class="num">${fmt(c.importe)}</td>${v}</tr>`).join('');
    const filasDesc = r.descuentos.map(x => `<tr><td>${x.nombre}</td><td class="num">${x.pct}%</td>${v}${v}<td class="num">${fmt(x.importe)}</td></tr>`).join('');
    const filasContrib = r.contribuciones.map(x =>
      `<tr><td>${x.nombre}</td><td class="num">${x.pct !== null && x.pct !== undefined ? x.pct + '%' : ''}</td><td class="num">${fmt(x.importe)}</td></tr>`).join('');

    const campoBasico = editable
      ? `<input type="number" class="input-basico" step="0.01" value="${r.basico}" onchange="Rural.cambiarBasico(this.value)" title="Podés modificarlo y se recalcula al instante">`
      : fmt(r.basico);

    const bloqueFirma = esDuplicado
      ? `<div class="recibo-firma"><div class="linea"></div>Firma del empleador</div>`
      : `<div class="recibo-firma">
        <div class="linea"></div>
        Firma del empleado
        <p style="margin-top:14px; font-size:10px;">Recibí el importe de esta liquidación en pago de mi remuneración correspondiente al período indicado y duplicado de la misma conforme a la ley vigente.</p>
      </div>`;

    return `
    <div class="recibo recibo-rural">
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
        <div><div class="label">Remuneración básica</div><div class="valor">${campoBasico}</div></div>
      </div>
      <div class="recibo-grid cols-5">
        <div><div class="label">Fecha ingreso</div><div class="valor">${fecha(legajo.fechaIngreso)}</div></div>
        <div><div class="label">Categoría</div><div class="valor">${legajo.categoria || '—'}</div></div>
        <div><div class="label">Tarea desempeñada</div><div class="valor">${legajo.tarea || '—'}</div></div>
        <div><div class="label">Fecha último depósito</div><div class="valor">${ctx.fechaPago ? fecha(ctx.fechaPago) : '—'}</div></div>
        <div><div class="label">Banco</div><div class="valor">${legajo.banco || '—'}</div></div>
      </div>

      <table class="recibo-conceptos">
        <thead>
          <tr><th style="width:34%">Conceptos</th><th>Un.</th><th>Remunerativo</th><th>No remunerativo</th><th>Descuentos</th></tr>
        </thead>
        <tbody>
          ${filasBasico}
          <tr><td>Antigüedad</td><td class="num">${r.antiguedadDetalle}</td><td class="num">${fmt(r.antiguedadImporte)}</td>${v}${v}</tr>
          <tr><td>Asistencia y Puntualidad</td>${v}<td class="num">${fmt(r.presentismoImporte)}</td>${v}${v}</tr>
          ${r.aCuenta ? `<tr><td>A cuenta de futuros aumentos</td>${v}<td class="num">${fmt(r.aCuenta)}</td>${v}${v}</tr>` : ''}
          ${filasFeriados}
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

      <div class="recibo-contrib-title">Contribuciones a cargo del empleador</div>
      <table class="recibo-conceptos">
        <thead><tr><th style="width:50%">Concepto</th><th>Un.</th><th>Importe</th></tr></thead>
        <tbody>
          ${filasContrib}
          <tr class="totales"><td>TOTAL CONTRIBUCIONES</td><td></td><td class="num">${fmt(r.totalContribuciones)}</td></tr>
        </tbody>
      </table>

      ${bloqueFirma}
      <div class="recibo-pie">Lugar y fecha de pago: ${cliente.provincia || ''}, ${ctx.fechaPago ? fecha(ctx.fechaPago) : '—'}</div>
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
    const recibos = document.querySelectorAll('#rurReciboContainer .recibo-rural');
    if (!recibos.length) return;

    const hojas = [...recibos].map(rec => {
      const tmp = document.createElement('div');
      tmp.innerHTML = rec.outerHTML;
      // el básico editable de la pantalla se imprime como texto
      tmp.querySelectorAll('input.input-basico').forEach(i => i.replaceWith(document.createTextNode(fmt(i.value))));
      return `<div class="hoja-a4">${tmp.innerHTML}</div>`;
    }).join('');
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
    const sel = $('rurCliente');
    const actual = sel.value;
    const clientes = await DB.getClientes();
    sel.innerHTML = '<option value="">Seleccionar cliente...</option>' +
      clientes.map(c => `<option value="${c.id}">${c.razonSocial}</option>`).join('');
    sel.value = actual;
  }

  function ocultarFormulario() {
    $('rurFormCard').style.display = 'none';
    $('rurResultadoCard').style.display = 'none';
  }

  function precargarContribucionesEspeciales() {
    const config = DB.getConfig();
    const anssal = config.contribuciones.find(c => c.id === 'anssalFsr');
    const os = config.contribuciones.find(c => c.id === 'obraSocialContrib');
    if (anssal) $('rurAnssalPct').value = String(anssal.pct);
    if (os) $('rurObraSocialContribPct').value = String(os.pct);
  }

  function aplicarModoAntiguedadUI() {
    const manual = $('rurAntigModo').value === 'manual';
    $('rurWrapAntigPct').style.display = manual ? 'none' : 'block';
    $('rurWrapAntigManual').style.display = manual ? 'block' : 'none';
  }

  /* ---- Filas de conceptos cargados a mano ---- */
  function agregarFilaConcepto(contenedorId, tipo) {
    const idx = tipo === 'rem' ? remCount++ : noRemCount++;
    const rowId = `rur-${tipo}-${idx}`;
    const div = document.createElement('div');
    div.className = 'fila-concepto';
    div.id = 'fila-' + rowId;
    div.innerHTML = `
      <input class="input concepto-nombre" placeholder="Concepto (a elección)">
      <input class="input concepto-importe" type="number" step="0.01" placeholder="Importe">
      <button class="btn-icon" title="Quitar" onclick="document.getElementById('fila-${rowId}').remove()">✖</button>`;
    $(contenedorId).appendChild(div);
  }

  function leerFilasConcepto(contenedorId) {
    const out = [];
    document.querySelectorAll(`#${contenedorId} .fila-concepto`).forEach(f => {
      const concepto = f.querySelector('.concepto-nombre').value.trim();
      const importe = f.querySelector('.concepto-importe').value;
      if (concepto && importe) out.push({ concepto, importe });
    });
    return out;
  }

  /* ---- Feriados: días x jornal ---- */
  function agregarFilaFeriado() {
    const rowId = 'rur-feriado-' + (feriadoCount++);
    const div = document.createElement('div');
    div.className = 'fila-feriado';
    div.id = 'fila-' + rowId;
    div.innerHTML = `
      <span>🎌 Feriados trabajados</span>
      <input class="input feriado-dias" type="number" step="1" min="0" placeholder="Cant. días" oninput="Rural.actualizarImporteFeriado('${rowId}')">
      <input class="input solo-lectura feriado-importe" type="text" readonly value="${fmt(0)}">
      <button class="btn-icon" title="Quitar" onclick="document.getElementById('fila-${rowId}').remove()">✖</button>`;
    $('rurListaRem').appendChild(div);
  }

  function actualizarImporteFeriado(rowId) {
    const fila = document.getElementById('fila-' + rowId);
    if (!fila) return;
    const dias = num(fila.querySelector('.feriado-dias').value);
    fila.querySelector('.feriado-importe').value = fmt(dias * num($('rurBasico').value));
  }

  function leerFeriados() {
    const out = [];
    document.querySelectorAll('#rurListaRem .fila-feriado').forEach(f => {
      const dias = num(f.querySelector('.feriado-dias').value);
      if (dias > 0) out.push({ dias });
    });
    return out;
  }

  async function calcularYMostrar() {
    try {
      const clienteId = $('rurCliente').value;
      const legajoId = $('rurLegajo').value;
      const periodo = $('rurPeriodo').value;
      const fechaPago = $('rurFechaPago').value;
      if (!clienteId || !legajoId || !periodo) { alert('Completá cliente, legajo y período antes de calcular.'); return; }

      const resultado = calcular({
        basico: $('rurBasico').value,
        diasTrabajados: $('rurDias').value,
        feriados: leerFeriados(),
        antigModo: $('rurAntigModo').value,
        antigPct: $('rurAntigPct').value,
        antigManualImporte: $('rurAntigManual').value,
        presentismoPct: $('rurPresentismoPct').value,
        aCuenta: $('rurACuenta').value,
        anssalFsrPct: $('rurAnssalPct').value,
        obraSocialContribPct: $('rurObraSocialContribPct').value,
        ffepImporte: $('rurFfep').value,
        remAdicionales: leerFilasConcepto('rurListaRem'),
        noRemAdicionales: leerFilasConcepto('rurListaNoRem')
      });
      const [cliente, legajo] = await Promise.all([DB.getCliente(clienteId), DB.getLegajo(legajoId)]);

      const [anio, mes] = periodo.split('-');
      contexto = {
        clienteId, legajoId, periodo,
        periodoTexto: `${MESES[parseInt(mes, 10) - 1].toUpperCase()} ${anio}`,
        fechaPago, tipoLiquidacion: 'rural', resultado
      };

      $('rurReciboContainer').innerHTML = renderRecibos(cliente, legajo, contexto, resultado, true);
      $('btnRurGuardar').style.display = 'inline-block';
      $('rurResultadoCard').style.display = 'block';
      $('rurResultadoCard').scrollIntoView({ behavior: 'smooth' });
    } catch (err) { mostrarErrorEnPantalla(err); }
  }

  /** Cambio del básico directamente desde el recibo: se recalcula al instante */
  function cambiarBasico(valor) {
    $('rurBasico').value = valor;
    document.querySelectorAll('#rurListaRem .fila-feriado').forEach(f => actualizarImporteFeriado(f.id.replace('fila-', '')));
    calcularYMostrar();
  }

  async function guardar() {
    if (!contexto) return;
    try {
      await DB.guardarLiquidacion(contexto);
      alert('Liquidación rural guardada correctamente.');
      await renderHistorial();
      await actualizarDashboard();
    } catch (err) { mostrarErrorEnPantalla(err); }
  }

  async function renderHistorial() {
    try {
      const [liqs, clientes, legajos] = await Promise.all([DB.getLiquidaciones(), DB.getClientes(), DB.getLegajos()]);
      const propias = liqs.filter(l => l.resultado && l.resultado.modoRural);
      const tbody = $('rurTablaHistorial');
      tbody.innerHTML = '';
      $('rurSinHistorial').style.display = propias.length ? 'none' : 'block';
      propias.forEach(l => {
        const cliente = clientes.find(c => c.id === l.clienteId);
        const legajo = legajos.find(x => x.id === l.legajoId);
        tbody.innerHTML += `<tr>
          <td>${l.periodoTexto}</td>
          <td>${cliente ? cliente.razonSocial : '—'}</td>
          <td>${legajo ? legajo.nombre : '—'}</td>
          <td>${fmt(l.resultado.neto)}</td>
          <td>
            <button class="btn-icon" title="Ver recibo" onclick="Rural.verRecibo('${l.id}')">👁️</button>
            <button class="btn-icon" title="Anular" onclick="Rural.anular('${l.id}')">🗑️</button>
          </td></tr>`;
      });
    } catch (err) { mostrarErrorEnPantalla(err); }
  }

  /** Muestra un recibo rural ya guardado (también se llama desde el Inicio / historial general) */
  async function verRecibo(id) {
    try {
      const liqs = await DB.getLiquidaciones();
      const liq = liqs.find(l => l.id === id);
      if (!liq) return;
      const [cliente, legajo] = await Promise.all([DB.getCliente(liq.clienteId), DB.getLegajo(liq.legajoId)]);

      document.querySelectorAll('.menu-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.querySelector('[data-view="rural"]').classList.add('active');
      $('view-rural').classList.add('active');
      await poblarClientes();
      await renderHistorial();

      contexto = null;
      $('rurReciboContainer').innerHTML = renderRecibos(cliente, legajo, liq, liq.resultado, false);
      $('btnRurGuardar').style.display = 'none';
      $('rurFormCard').style.display = 'none';
      $('rurResultadoCard').style.display = 'block';
      $('rurResultadoCard').scrollIntoView({ behavior: 'smooth' });
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

  function init() {
    $('rurCliente').addEventListener('change', async (e) => {
      const sel = $('rurLegajo');
      const legajos = e.target.value ? await DB.getLegajosPorCliente(e.target.value) : [];
      sel.innerHTML = '<option value="">Seleccionar legajo...</option>' +
        legajos.map(l => `<option value="${l.id}">${l.legajo} - ${l.nombre}</option>`).join('');
      sel.disabled = !e.target.value;
      ocultarFormulario();
    });

    $('rurLegajo').addEventListener('change', async (e) => {
      if (!e.target.value) { ocultarFormulario(); return; }
      const legajo = await DB.getLegajo(e.target.value);
      $('rurBasico').value = legajo.basico || '';
      $('rurFormCard').style.display = 'block';
      $('rurResultadoCard').style.display = 'none';
    });

    $('rurAntigModo').addEventListener('change', aplicarModoAntiguedadUI);
    aplicarModoAntiguedadUI();

    $('btnRurAddRem').addEventListener('click', () => agregarFilaConcepto('rurListaRem', 'rem'));
    $('btnRurAddNoRem').addEventListener('click', () => agregarFilaConcepto('rurListaNoRem', 'norem'));
    $('btnRurAddFeriado').addEventListener('click', agregarFilaFeriado);
    $('btnRurCalcular').addEventListener('click', calcularYMostrar);
    $('btnRurGuardar').addEventListener('click', guardar);
    $('btnRurImprimir').addEventListener('click', imprimir);

    // Al entrar a la pantalla se cargan clientes, historial y los % de Configuración
    document.querySelector('[data-view="rural"]').addEventListener('click', async () => {
      precargarContribucionesEspeciales();
      await poblarClientes();
      await renderHistorial();
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return { calcular, verRecibo, anular, cambiarBasico, actualizarImporteFeriado, _renderRecibos: renderRecibos, _CSS: CSS_IMPRESION, _aLetras: aLetras };
})();