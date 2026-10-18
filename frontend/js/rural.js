/* =========================================================
   rural.js
   MÓDULO INDEPENDIENTE de liquidación RURAL.
   Tiene su propia pantalla, su propio cálculo y su propio recibo.
   No usa nada de Metalúrgica, Mensual ni Gastronómico.

   Reglas:
   - Remuneración: MENSUAL (importe) o JORNAL (jornal x días trabajados)
   - Feriado rural = días x valor del día
       (jornal: el jornal; mensual: mensual ÷ 25, editable)
   - Antigüedad (modo por defecto: SIN ANTIGÜEDAD):
       PERMANENTES    -> sin antigüedad (por defecto), automático (años completos
                         desde el ingreso x 1% sobre remuneración + feriados),
                         porcentaje manual o importe manual
       NO PERMANENTES -> solo importe manual
       Si la antigüedad es $ 0,00 NO se imprime en el recibo.
   - Total remunerativo = remuneración + antigüedad + feriados
                          + todos los conceptos remunerativos agregados
   - Retenciones y contribuciones: porcentajes fijos (ver PARAM)
   Solo reutiliza la capa de datos (DB) para clientes, legajos y liquidaciones.
========================================================= */

const Rural = (() => {

  /* ---------- Porcentajes fijos de esta categoría (se cambian solo acá) ---------- */
  const PARAM = {
    antiguedadPctPorAnio: 1,
    valorDiaMensualDivisor: 25,   // valor del día de feriado para remuneración mensual
    retenciones: [                // todas sobre el total remunerativo
      { id: 'jubilacionCCG', nombre: 'Jubilación CCG', pct: 11 },
      { id: 'ley19032CCG', nombre: 'Ley 19.032 CCG', pct: 3 },
      { id: 'obraSocialCCG', nombre: 'Obra Social CCG', pct: 3 },
      { id: 'renatreSepelio', nombre: 'RENATRE seguro de sepelio', pct: 1.5 },
      { id: 'aporteSolidario', nombre: 'Cuota aporte solidario', pct: 2 }
    ],
    contribuciones: [             // todas sobre el total remunerativo
      { id: 'sipa', nombre: 'SIPA - Ley 24.241', pct: 10.77 },
      { id: 'ley19032', nombre: 'Ley 19.032 - INSSJP', pct: 1.59 },
      { id: 'obraSocial', nombre: 'Obra Social', pct: 6 },
      { id: 'asigFam', nombre: 'Asignaciones Familiares', pct: 4.7 },
      { id: 'fondoEmpleo', nombre: 'Fondo Nacional de Empleo', pct: 0.94 },
      { id: 'renatea', nombre: 'Contribución RENATEA', pct: 1.5 }
    ]
  };

  const $ = (id) => document.getElementById(id);
  const num = (v) => Number(v) || 0;
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const suma = (arr) => arr.reduce((a, b) => a + b, 0);
  const fmt = (n) => '$ ' + num(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fecha = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
  const ACTIVIDAD_RURAL = 'Trabajador agrario Ley 26.727';
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  let contexto = null;        // liquidación calculada pendiente de guardar
  let legajoActual = null;    // legajo seleccionado
  let remCount = 0, noRemCount = 0, feriadoCount = 0;

  /** Permanente = "Permanente" o los legajos viejos "Por tiempo indeterminado". Todo lo demás: no permanente. */
  function esPermanente(legajo) {
    const t = legajo && legajo.tipoContrato;
    return !t || /indeterminado|^\s*permanente/i.test(t);
  }

  /** Años completos entre la fecha de ingreso y el día de liquidación (YYYY-MM-DD) */
  function aniosCompletos(ingresoIso, hastaIso) {
    if (!ingresoIso) return 0;
    const [yi, mi, di] = String(ingresoIso).slice(0, 10).split('-').map(Number);
    let yh, mh, dh;
    if (hastaIso) {
      [yh, mh, dh] = String(hastaIso).slice(0, 10).split('-').map(Number);
    } else {
      const h = new Date(); yh = h.getFullYear(); mh = h.getMonth() + 1; dh = h.getDate();
    }
    let y = yh - yi;
    if (mh < mi || (mh === mi && dh < di)) y--;
    return Math.max(0, y);
  }

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
     datos: { tipoRemuneracion:'mensual'|'jornal', remuneracion, diasTrabajados,
              valorDia, feriados:[{dias}], permanente, fechaIngreso, fechaLiquidacion,
              antigModo:'ninguna'|'auto'|'porcentaje'|'importe',
              antigPctManual, antigManualImporte, lugar,
              remAdicionales:[{concepto,importe}], noRemAdicionales:[{concepto,importe}] }
  ========================================================= */
  function calcular(d) {
    const mensual = d.tipoRemuneracion === 'mensual';
    const valor = num(d.remuneracion);
    const diasTrabajados = mensual ? 0 : num(d.diasTrabajados);

    // Remuneración base: mensual (importe) o jornal x días
    const basicoImporte = mensual ? r2(valor) : r2(valor * diasTrabajados);

    // Feriado rural: días x valor del día (jornal; o mensual ÷ 25 si no se indica otro)
    const valorDia = mensual
      ? ((d.valorDia !== undefined && d.valorDia !== '' && d.valorDia !== null) ? num(d.valorDia) : r2(valor / PARAM.valorDiaMensualDivisor))
      : valor;
    const feriados = (d.feriados || []).map(f => ({ dias: num(f.dias), importe: r2(num(f.dias) * valorDia) }));
    const totalFeriados = r2(suma(feriados.map(f => f.importe)));

    // Antigüedad (por defecto: SIN antigüedad)
    let anios = 0, antiguedadPct = 0, antiguedadImporte = 0, antiguedadDetalle = '';
    if (d.permanente) {
      const baseAntig = basicoImporte + totalFeriados;
      const modo = d.antigModo || 'ninguna';
      if (modo === 'ninguna') {                       // sin antigüedad
        antiguedadImporte = 0;
        antiguedadDetalle = '';
      } else if (modo === 'importe') {                // importe manual
        antiguedadImporte = r2(num(d.antigManualImporte));
        antiguedadDetalle = '';
      } else if (modo === 'porcentaje') {             // porcentaje manual
        antiguedadPct = num(d.antigPctManual);
        antiguedadImporte = r2(baseAntig * antiguedadPct / 100);
        antiguedadDetalle = antiguedadPct + '%';
      } else if (modo === 'auto') {                   // automático: años completos x 1%
        anios = aniosCompletos(d.fechaIngreso, d.fechaLiquidacion);
        antiguedadPct = anios * PARAM.antiguedadPctPorAnio;
        antiguedadImporte = r2(baseAntig * antiguedadPct / 100);
        antiguedadDetalle = antiguedadPct + '%';
      }
    } else {
      antiguedadImporte = r2(num(d.antigManualImporte));
      antiguedadDetalle = '';
    }

    const remAdicionales = (d.remAdicionales || []).map(x => ({ concepto: x.concepto, importe: r2(num(x.importe)) }));
    const noRemAdicionales = (d.noRemAdicionales || []).map(x => ({ concepto: x.concepto, importe: r2(num(x.importe)) }));

    const totalRemunerativo = r2(basicoImporte + antiguedadImporte + totalFeriados +
      suma(remAdicionales.map(x => x.importe)));
    const totalNoRemunerativo = r2(suma(noRemAdicionales.map(x => x.importe)));

    // Retenciones (sobre el total remunerativo)
    const descuentos = PARAM.retenciones.map(x => ({
      id: x.id, nombre: x.nombre, pct: x.pct, importe: r2(totalRemunerativo * x.pct / 100)
    }));
    const totalDescuentos = r2(suma(descuentos.map(x => x.importe)));
    const neto = r2(totalRemunerativo + totalNoRemunerativo - totalDescuentos);

    // Contribuciones aplicables (sobre el total remunerativo)
    const contribuciones = PARAM.contribuciones.map(x => ({
      id: x.id, nombre: x.nombre, pct: x.pct, importe: r2(totalRemunerativo * x.pct / 100)
    }));
    const totalContribuciones = r2(suma(contribuciones.map(x => x.importe)));

    return {
      modoRural: true,
      tipoLiquidacion: 'rural',
      tipoRemuneracion: mensual ? 'mensual' : 'jornal',
      permanente: !!d.permanente,
      lugarPago: String(d.lugar || '').trim(),
      basico: valor, diasTrabajados, basicoImporte, valorDia,
      feriados, totalFeriados,
      anios, antiguedadPct, antiguedadImporte, antiguedadDetalle,
      presentismoImporte: 0,
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
     Funciona también con liquidaciones rurales guardadas antes (jornal).
  ========================================================= */
  function renderRecibos(cliente, legajo, ctx, r, editable) {
    return renderRecibo(cliente, legajo, ctx, r, 'original', editable) +
      `<div style="display:none">${renderRecibo(cliente, legajo, ctx, r, 'duplicado', false)}</div>`;
  }

  function renderRecibo(cliente, legajo, ctx, r, copia, editable) {
    const esDuplicado = copia === 'duplicado';
    const mensual = r.tipoRemuneracion === 'mensual';
    const v = '<td class="num"></td>';

    const filasBasico = mensual
      ? `<tr><td>Remuneración mensual</td>${v}<td class="num">${fmt(r.basicoImporte)}</td>${v}${v}</tr>`
      : `<tr><td>Cantidad de días trabajados</td><td class="num">${r.diasTrabajados}</td><td class="num">${fmt(r.basicoImporte)}</td>${v}${v}</tr>`;
    const filasFeriados = (r.feriados || []).map(f =>
      `<tr><td>Feriado rural</td><td class="num">${f.dias}</td><td class="num">${fmt(f.importe)}</td>${v}${v}</tr>`).join('');
    const filasRem = r.remAdicionales.map(c => `<tr><td>${c.concepto}</td>${v}<td class="num">${fmt(c.importe)}</td>${v}${v}</tr>`).join('');
    const filasNoRem = r.noRemAdicionales.map(c => `<tr><td>${c.concepto}</td>${v}${v}<td class="num">${fmt(c.importe)}</td>${v}</tr>`).join('');
    const filasDesc = r.descuentos.map(x => `<tr><td>${x.nombre}</td><td class="num">${x.pct}%</td>${v}${v}<td class="num">${fmt(x.importe)}</td></tr>`).join('');
    const filasContrib = r.contribuciones.map(x =>
      `<tr><td>${x.nombre}</td><td class="num">${x.pct !== null && x.pct !== undefined ? x.pct + '%' : ''}</td><td class="num">${fmt(x.importe)}</td></tr>`).join('');

    // La antigüedad solo se imprime si es mayor a $ 0,00
    const filaAntiguedad = num(r.antiguedadImporte) > 0
      ? `<tr><td>Antigüedad</td><td class="num">${r.antiguedadDetalle || ''}</td><td class="num">${fmt(r.antiguedadImporte)}</td>${v}${v}</tr>`
      : '';

    const campoBasico = editable
      ? `<input type="number" class="input-basico" step="0.01" value="${r.basico}" onchange="Rural.cambiarRemuneracion(this.value)" title="Podés modificarlo y se recalcula al instante">`
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
        <div><div class="label">Tipo de trabajador</div><div class="valor">${legajo.tipoContrato || '—'}</div></div>
        <div><div class="label">Obra social</div><div class="valor">${legajo.obraSocial || '—'}</div></div>
        <div><div class="label">${mensual ? 'Remuneración mensual' : 'Remuneración jornal'}</div><div class="valor">${campoBasico}</div></div>
      </div>
      <div class="recibo-grid cols-5">
        <div><div class="label">Fecha ingreso</div><div class="valor">${fecha(legajo.fechaIngreso)}</div></div>
        <div><div class="label">Categoría</div><div class="valor">${legajo.categoria || '—'}</div></div>
        <div><div class="label">Modalidad de contratación</div><div class="valor">${legajo.tarea || '—'}</div></div>
        <div><div class="label">Actividad</div><div class="valor">${ACTIVIDAD_RURAL}</div></div>
        <div><div class="label">Banco</div><div class="valor">${legajo.banco || '—'}</div></div>
      </div>

      <table class="recibo-conceptos">
        <thead>
          <tr><th style="width:34%">Conceptos</th><th>Un.</th><th>Remunerativo</th><th>No remunerativo</th><th>Descuentos</th></tr>
        </thead>
        <tbody>
          ${filasBasico}
          ${filaAntiguedad}
          ${r.presentismoImporte ? `<tr><td>Asistencia y Puntualidad</td>${v}<td class="num">${fmt(r.presentismoImporte)}</td>${v}${v}</tr>` : ''}
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

  /** Red de seguridad: borra del recibo ya dibujado cualquier fila Antigüedad con importe $ 0,00 */
  function limpiarAntiguedadCero(contenedor) {
    contenedor.querySelectorAll('table.recibo-conceptos tbody tr').forEach(tr => {
      const celdas = tr.querySelectorAll('td');
      if (celdas.length >= 3 && /^\s*Antig[üu]edad\s*$/i.test(celdas[0].textContent)) {
        const importe = parseFloat(String(celdas[2].textContent).replace(/[^\d,-]/g, '').replace(',', '.')) || 0;
        if (importe <= 0) tr.remove();
      }
    });
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
    .recibo-copia { text-align: right; font-size: 8pt; font-weight: 700;