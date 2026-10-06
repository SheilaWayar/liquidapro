/* =========================================================
   metalurgica.js
   MÓDULO INDEPENDIENTE de liquidación METALÚRGICA (UOM).
   Tiene su propia pantalla, su propio cálculo y su propio recibo.
   No usa nada de Rural, Mensual ni Gastronómico.
   Solo reutiliza la capa de datos (DB) para clientes, legajos
   y para guardar/leer liquidaciones.
========================================================= */

const Metalurgica = (() => {

  /* ---------- Porcentajes fijos de esta categoría (se cambian solo acá) ---------- */
  const PARAM = {
    antiguedadPctPorAnio: 1,
    retenciones: {
      jubilacion: 11,      // sobre total remunerativo
      ley19032: 3,         // sobre total remunerativo
      obraSocial: 3,       // sobre remunerativo + no remunerativo
      cuotaSindical: 2.5   // sobre remunerativo + no remunerativo
    },
    contribuciones: {      // todas sobre total remunerativo
      sipa: 10.77,
      ley19032: 1.59,
      obraSocial: 6,
      asigFam: 4.7,
      fondoEmpleo: 0.94
    }
  };

  const $ = (id) => document.getElementById(id);
  const num = (v) => Number(v) || 0;
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const suma = (arr) => arr.reduce((a, b) => a + b, 0);
  const fmt = (n) => '$ ' + num(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fecha = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
  const mesAnio = (ym) => { if (!ym) return ''; const [y, m] = String(ym).split('-'); return `${m}/${y}`; };
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  let contexto = null;      // liquidación calculada pendiente de guardar
  let legajoActual = null;  // legajo seleccionado (para la vista previa de antigüedad)

  /* ---------- Número a letras (propio de este módulo, no depende de calculos.js) ---------- */
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
    const centavos = Math.round((monto - entero) * 100);
    const millones = Math.floor(entero / 1000000);
    const miles = Math.floor((entero % 1000000) / 1000);
    const resto = entero % 1000;
    const partes = [];
    if (millones) partes.push(millones === 1 ? 'un millón' : centenasALetras(millones, true) + ' millones');
    if (miles) partes.push(miles === 1 ? 'mil' : centenasALetras(miles, true) + ' mil');
    if (resto) partes.push(centenasALetras(resto, false));
    return `${partes.join(' ') || 'cero'} con ${String(centavos).padStart(2, '0')}/100`;
  }

  /* ---------- Años completos desde ingreso hasta el día de liquidación ---------- */
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

  /* =========================================================
     CÁLCULO
     datos: { valorHora, horas, imgr, noRem, seguroUom, ffep,
              seguroVidaSepelio, fechaIngreso, fechaLiquidacion }
  ========================================================= */
  function calcular(d) {
    const valorHora = num(d.valorHora);
    const horas = num(d.horas);

    // Horas x básico por hora
    const remuneracionBase = r2(horas * valorHora);

    // Antigüedad automática: años completos x 1% x remuneración base
    const anios = aniosCompletos(d.fechaIngreso, d.fechaLiquidacion);
    const antiguedad = r2(remuneracionBase * anios * PARAM.antiguedadPctPorAnio / 100);

    // IMGR = índice ingresado - (remuneración base + antigüedad). Nunca negativo.
    const imgrTotal = r2(num(d.imgr));
    const sumaBase = r2(remuneracionBase + antiguedad);
    const imgr = imgrTotal > 0 ? Math.max(0, r2(imgrTotal - sumaBase)) : 0;

    const totalRemunerativo = r2(sumaBase + imgr);
    const noRemItems = (d.noRemItems || []).map(x => ({ concepto: x.concepto, importe: r2(num(x.importe)) }));
    const noRemunerativo = r2(suma(noRemItems.map(x => x.importe)));
    const baseTotal = r2(totalRemunerativo + noRemunerativo);

    // Retenciones
    const R = PARAM.retenciones;
    const descuentos = [
      { nombre: 'Jubilación', pct: R.jubilacion, importe: r2(totalRemunerativo * R.jubilacion / 100) },
      { nombre: 'Ley 19.032 - INSSJP', pct: R.ley19032, importe: r2(totalRemunerativo * R.ley19032 / 100) },
      { nombre: 'Obra Social', pct: R.obraSocial, importe: r2(baseTotal * R.obraSocial / 100) },
      { nombre: 'Cuota sindical', pct: R.cuotaSindical, importe: r2(baseTotal * R.cuotaSindical / 100) }
    ];
    const seguroUom = r2(num(d.seguroUom));
    if (seguroUom > 0) descuentos.push({ nombre: 'Seguro UOM', pct: null, importe: seguroUom });
    const totalDescuentos = r2(suma(descuentos.map(x => x.importe)));

    const neto = r2(baseTotal - totalDescuentos);

    // Contribuciones aplicables
    const C = PARAM.contribuciones;
    const contribuciones = [
      { nombre: 'SIPA - Ley 24.241', pct: C.sipa },
      { nombre: 'Ley 19.032 - INSSJP', pct: C.ley19032 },
      { nombre: 'Obra Social', pct: C.obraSocial, sobreTotal: true }, // remunerativo + no remunerativo
      { nombre: 'Asignaciones Familiares', pct: C.asigFam },
      { nombre: 'Fondo Nacional de Empleo', pct: C.fondoEmpleo }
    ].map(x => ({ ...x, importe: r2((x.sobreTotal ? baseTotal : totalRemunerativo) * x.pct / 100) }));
    const ffep = r2(num(d.ffep));
    if (ffep > 0) contribuciones.push({ nombre: 'Riesgo de trabajo - FFEP', pct: null, importe: ffep });
    const seguroVida = r2(num(d.seguroVidaSepelio));
    if (seguroVida > 0) contribuciones.push({ nombre: 'Seguro de vida y sepelio', pct: null, importe: seguroVida });
    const totalContribuciones = r2(suma(contribuciones.map(x => x.importe)));

    return {
      modoUOM: true,
      tipoLiquidacion: 'metalurgica',
      lugarPago: String(d.lugar || '').trim(),
      fechaRecibo: d.fechaRecibo || '',
      periodoDeposito: d.periodoDeposito || '',
      valorHora, horas, remuneracionBase,
      anios, antiguedadPct: anios * PARAM.antiguedadPctPorAnio, antiguedad,
      imgrTotal, imgr,
      totalRemunerativo, noRemunerativo, noRemItems,
      descuentos, totalDescuentos, neto,
      contribuciones, totalContribuciones
    };
  }

  /* =========================================================
     RECIBO (HTML propio de Metalúrgica)
  ========================================================= */
  function filasNoRem(r) {
    const v = '<td class="num"></td>';
    const items = (r.noRemItems && r.noRemItems.length)
      ? r.noRemItems
      : (r.noRemunerativo > 0 ? [{ concepto: 'Concepto no remunerativo', importe: r.noRemunerativo }] : []); // liquidaciones viejas
    return items.map(x => `<tr><td>${x.concepto}</td>${v}${v}<td class="num">${fmt(x.importe)}</td>${v}</tr>`).join('');
  }

  /** Devuelve el ORIGINAL (firma del empleado) y el DUPLICADO (firma del empleador). El duplicado solo se ve al imprimir. */
  function renderRecibos(cliente, legajo, ctx, r) {
    return renderRecibo(cliente, legajo, ctx, r, 'original') +
      `<div class="met-duplicado">${renderRecibo(cliente, legajo, ctx, r, 'duplicado')}</div>`;
  }

  function renderRecibo(cliente, legajo, ctx, r, copia) {
    const esDuplicado = copia === 'duplicado';
    const bloqueFirma = esDuplicado
      ? `<div class="recibo-firma"><div class="linea"></div>Firma del empleador</div>`
      : `<div class="recibo-firma">
        <div class="linea"></div>
        Firma del empleado
        <p style="margin-top:14px; font-size:10px;">Recibí el importe de esta liquidación en pago de mi remuneración correspondiente al período indicado y duplicado de la misma conforme a la ley vigente.</p>
      </div>`;
    const vacio = '<td class="num"></td>';
    const filasDesc = r.descuentos.map(x =>
      `<tr><td>${x.nombre}</td><td class="num">${x.pct !== null ? x.pct + '%' : ''}</td>${vacio}${vacio}<td class="num">${fmt(x.importe)}</td></tr>`).join('');
    const filasContrib = r.contribuciones.map(x =>
      `<tr><td>${x.nombre}</td><td class="num">${x.pct !== null ? x.pct + '%' : ''}</td><td class="num">${fmt(x.importe)}</td></tr>`).join('');

    return `
    <div class="recibo recibo-met">
      <div class="recibo-copia">${esDuplicado ? 'DUPLICADO' : 'ORIGINAL'}</div>
      <div class="recibo-titulo">RECIBO DE HABERES LEY 20.744</div>
      <div class="recibo-empresa">
        <div class="razon">${cliente.razonSocial}</div>
        <div>C.U.I.T: ${cliente.cuit}</div>
        <div>${[cliente.domicilio, cliente.provincia].filter(Boolean).join(' - ')}</div>
      </div>
      <div class="recibo-grid cols-2">
        <div><div class="label">Quincena abonada</div><div class="valor">${ctx.quincenaTexto} de ${ctx.periodoTexto}</div></div>
        <div><div class="label">Legajo N°</div><div class="valor">${legajo.legajo}</div></div>
      </div>
      <div class="recibo-grid cols-2">
        <div><div class="label">Apellido y nombre</div><div class="valor">${legajo.nombre}</div></div>
        <div><div class="label">C.U.I.L. empleado</div><div class="valor">${legajo.cuil}</div></div>
      </div>
      <div class="recibo-grid cols-3">
        <div><div class="label">Tipo de contrato</div><div class="valor">${legajo.tipoContrato || '—'}</div></div>
        <div><div class="label">Obra social</div><div class="valor">${legajo.obraSocial || '—'}</div></div>
        <div><div class="label">Básico por hora</div><div class="valor">${fmt(r.valorHora)}</div></div>
      </div>
      <div class="recibo-grid cols-5" style="grid-template-columns:repeat(6,1fr)">
        <div><div class="label">Fecha ingreso</div><div class="valor">${fecha(legajo.fechaIngreso)}</div></div>
        <div><div class="label">Categoría</div><div class="valor">${legajo.categoria || '—'}</div></div>
        <div><div class="label">Tarea desempeñada</div><div class="valor">${legajo.tarea || '—'}</div></div>
        <div><div class="label">Fecha último depósito</div><div class="valor">${ctx.fechaPago ? fecha(ctx.fechaPago) : '—'}</div></div>
        <div><div class="label">Período</div><div class="valor">${mesAnio(r.periodoDeposito) || '—'}</div></div>
        <div><div class="label">Banco</div><div class="valor">${legajo.banco || '—'}</div></div>
      </div>

      <table class="recibo-conceptos">
        <thead>
          <tr><th style="width:34%">Conceptos</th><th>Un.</th><th>Remunerativo</th><th>No remunerativo</th><th>Descuentos</th></tr>
        </thead>
        <tbody>
          <tr><td>Horas trabajadas</td><td class="num">${r.horas} hs</td><td class="num">${fmt(r.remuneracionBase)}</td>${vacio}${vacio}</tr>
          <tr><td>Antigüedad</td><td class="num">${r.antiguedadPct !== undefined ? r.antiguedadPct : r.anios * PARAM.antiguedadPctPorAnio}%</td><td class="num">${fmt(r.antiguedad)}</td>${vacio}${vacio}</tr>
          <tr><td>I.M.G.R. (Índice Mínimo Global Remunerativo)</td>${vacio}<td class="num">${fmt(r.imgr)}</td>${vacio}${vacio}</tr>
          ${filasNoRem(r)}
          ${filasDesc}
          <tr class="totales">
            <td>TOTALES</td><td></td>
            <td class="num">${fmt(r.totalRemunerativo)}</td>
            <td class="num">${fmt(r.noRemunerativo)}</td>
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
      <div class="recibo-pie">Lugar y fecha de pago: ${r.lugarPago || cliente.provincia || ''}, ${fecha(r.fechaRecibo) || (ctx.fechaPago ? fecha(ctx.fechaPago) : '—')}</div>
    </div>`;
  }

  /* =========================================================
     PANTALLA
  ========================================================= */
  async function poblarClientes() {
    const sel = $('metCliente');
    const actual = sel.value;
    const clientes = await DB.getClientes();
    sel.innerHTML = '<option value="">Seleccionar cliente...</option>' +
      clientes.map(c => `<option value="${c.id}">${c.razonSocial}</option>`).join('');
    sel.value = actual;
  }

  /* Vista previa en vivo: antigüedad e IMGR (se actualiza al cambiar horas, básico, IMGR o fecha de pago) */
  function actualizarAntiguedadPreview() {
    const box = $('metAntigPreview');
    if (!legajoActual) { box.style.display = 'none'; return; }
    box.style.display = 'block';

    const ingreso = legajoActual.fechaIngreso;
    const liq = $('metFechaPago').value;
    const base = r2(num($('metHoras').value) * num($('metValorHora').value));
    const anios = ingreso ? aniosCompletos(ingreso, liq) : 0;
    const pct = anios * PARAM.antiguedadPctPorAnio;
    const antig = r2(base * pct / 100);
    const sumaBase = r2(base + antig);

    let lineaAntig;
    if (!ingreso) {
      lineaAntig = '⚠️ Este legajo no tiene fecha de ingreso cargada: la antigüedad será $ 0,00. Editá el legajo para cargarla.';
    } else {
      lineaAntig = `<strong>Antigüedad:</strong> ingreso ${fecha(ingreso)} · día de liquidación ${liq ? fecha(liq) : 'hoy (no cargaste fecha de pago)'} → ` +
        `${anios} años × ${PARAM.antiguedadPctPorAnio}% = <strong>${pct}%</strong> sobre ${fmt(base)} = <strong>${fmt(antig)}</strong>`;
    }

    const imgrTotal = r2(num($('metImgr').value));
    let lineaImgr;
    if (imgrTotal <= 0) {
      lineaImgr = '<strong>IMGR:</strong> cargá el total del índice (campo "IMGR — total del índice") para que se calcule.';
    } else if (imgrTotal > sumaBase) {
      lineaImgr = `<strong>IMGR:</strong> ${fmt(imgrTotal)} − (${fmt(base)} + ${fmt(antig)} = ${fmt(sumaBase)}) = <strong>${fmt(r2(imgrTotal - sumaBase))}</strong>`;
    } else {
      lineaImgr = `<strong>IMGR:</strong> ⚠️ el índice (${fmt(imgrTotal)}) no supera horas + antigüedad (${fmt(sumaBase)}), por eso el IMGR da <strong>$ 0,00</strong>.`;
    }

    $('metAntigTexto').innerHTML = lineaAntig + '<br>' + lineaImgr;
  }

  function agregarNoRem() {
    const div = document.createElement('div');
    div.className = 'fila-concepto';
    div.innerHTML = `
      <input class="input concepto-nombre" placeholder="Concepto">
      <input class="input concepto-importe" type="number" step="0.01" placeholder="Importe">
      <button class="btn-icon" title="Quitar" onclick="this.parentElement.remove()">✖</button>`;
    $('metListaNoRem').appendChild(div);
  }

  function leerNoRem() {
    const out = [];
    document.querySelectorAll('#metListaNoRem .fila-concepto').forEach(f => {
      const concepto = f.querySelector('.concepto-nombre').value.trim();
      const importe = f.querySelector('.concepto-importe').value;
      if (concepto && importe) out.push({ concepto, importe });
    });
    return out;
  }

  function ocultarFormulario() {
    legajoActual = null;
    $('metFormCard').style.display = 'none';
    $('metResultadoCard').style.display = 'none';
  }

  async function calcularYMostrar() {
    try {
      const clienteId = $('metCliente').value;
      const legajoId = $('metLegajo').value;
      const periodo = $('metPeriodo').value;
      const fechaPago = $('metFechaPago').value;
      if (!clienteId || !legajoId || !periodo) { alert('Completá cliente, legajo y período antes de calcular.'); return; }
      if (!(num($('metValorHora').value) > 0) || !(num($('metHoras').value) > 0)) {
        alert('Cargá las horas trabajadas y el básico por hora.'); return;
      }

      const [cliente, legajo] = await Promise.all([DB.getCliente(clienteId), DB.getLegajo(legajoId)]);

      if (!legajo.fechaIngreso &&
          !confirm('Este legajo no tiene fecha de ingreso: la antigüedad va a ser $ 0,00. ¿Calcular igual?')) return;

      const resultado = calcular({
        valorHora: $('metValorHora').value,
        horas: $('metHoras').value,
        imgr: $('metImgr').value,
        noRemItems: leerNoRem(),
        lugar: $('metLugar').value,
        fechaRecibo: $('metFechaRecibo').value,
        periodoDeposito: $('metPeriodoDeposito').value,
        seguroUom: $('metSeguroUom').value,
        ffep: $('metFfep').value,
        seguroVidaSepelio: $('metSeguroVida').value,
        fechaIngreso: legajo.fechaIngreso,
        fechaLiquidacion: fechaPago // vacío = fecha de hoy
      });

      const [anio, mes] = periodo.split('-');
      contexto = {
        clienteId, legajoId, periodo,
        periodoTexto: `${MESES[parseInt(mes, 10) - 1].toUpperCase()} ${anio}`,
        quincenaTexto: $('metQuincena').value === '1' ? 'Primera quincena' : 'Segunda quincena',
        fechaPago, tipoLiquidacion: 'metalurgica', resultado
      };

      $('metReciboContainer').innerHTML = renderRecibos(cliente, legajo, contexto, resultado);
      $('btnMetGuardar').style.display = 'inline-block';
      $('metResultadoCard').style.display = 'block';
      $('metResultadoCard').scrollIntoView({ behavior: 'smooth' });
    } catch (err) { mostrarErrorEnPantalla(err); }
  }

  async function guardar() {
    if (!contexto) return;
    try {
      await DB.guardarLiquidacion(contexto);
      alert('Liquidación metalúrgica guardada correctamente.');
      await renderHistorial();
      await actualizarDashboard();
    } catch (err) { mostrarErrorEnPantalla(err); }
  }

  async function renderHistorial() {
    try {
      const [liqs, clientes, legajos] = await Promise.all([DB.getLiquidaciones(), DB.getClientes(), DB.getLegajos()]);
      const propias = liqs.filter(l => l.resultado && l.resultado.modoUOM);
      const tbody = $('metTablaHistorial');
      tbody.innerHTML = '';
      $('metSinHistorial').style.display = propias.length ? 'none' : 'block';
      propias.forEach(l => {
        const cliente = clientes.find(c => c.id === l.clienteId);
        const legajo = legajos.find(x => x.id === l.legajoId);
        tbody.innerHTML += `<tr>
          <td>${l.quincenaTexto || ''} - ${l.periodoTexto}</td>
          <td>${cliente ? cliente.razonSocial : '—'}</td>
          <td>${legajo ? legajo.nombre : '—'}</td>
          <td>${fmt(l.resultado.neto)}</td>
          <td>
            <button class="btn-icon" title="Ver recibo" onclick="Metalurgica.verRecibo('${l.id}')">👁️</button>
            <button class="btn-icon" title="Anular" onclick="Metalurgica.anular('${l.id}')">🗑️</button>
          </td></tr>`;
      });
    } catch (err) { mostrarErrorEnPantalla(err); }
  }

  /** Muestra un recibo metalúrgico ya guardado (se llama también desde el Inicio / historial general) */
  async function verRecibo(id) {
    try {
      const liqs = await DB.getLiquidaciones();
      const liq = liqs.find(l => l.id === id);
      if (!liq) return;
      const [cliente, legajo] = await Promise.all([DB.getCliente(liq.clienteId), DB.getLegajo(liq.legajoId)]);

      document.querySelectorAll('.menu-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.querySelector('[data-view="metalurgica"]').classList.add('active');
      $('view-metalurgica').classList.add('active');
      await poblarClientes();
      await renderHistorial();

      contexto = null;
      $('metReciboContainer').innerHTML = renderRecibos(cliente, legajo, liq, liq.resultado);
      $('btnMetGuardar').style.display = 'none'; // ya está guardado
      $('metFormCard').style.display = 'none';
      $('metResultadoCard').style.display = 'block';
      $('metResultadoCard').scrollIntoView({ behavior: 'smooth' });
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

  /* Estilo propio del recibo impreso (A4). No depende de style.css, así el diseño
     no se deforma al imprimir: columnas fijas y líneas divisorias entre secciones. */
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

  /* Imprime ORIGINAL y DUPLICADO, cada uno en su propia hoja A4 (vertical).
     Se arma en un iframe oculto con solo los recibos; cada recibo se mide y, si
     hace falta, se achica automáticamente para que entre completo en una hoja. */
  function imprimir() {
    const recibos = document.querySelectorAll('#metReciboContainer .recibo-met');
    if (!recibos.length) return;

    const hojas = [...recibos].map(r => `<div class="hoja-a4">${r.outerHTML}</div>`).join('');
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
            const s = Math.floor(escala * 100) / 100; // un poco por debajo para asegurar que entre
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

  function init() {
    $('metCliente').addEventListener('change', async (e) => {
      const sel = $('metLegajo');
      const legajos = e.target.value ? await DB.getLegajosPorCliente(e.target.value) : [];
      sel.innerHTML = '<option value="">Seleccionar legajo...</option>' +
        legajos.map(l => `<option value="${l.id}">${l.legajo} - ${l.nombre}</option>`).join('');
      sel.disabled = !e.target.value;
      ocultarFormulario();
    });

    $('metLegajo').addEventListener('change', async (e) => {
      if (!e.target.value) { ocultarFormulario(); return; }
      const legajo = await DB.getLegajo(e.target.value);
      $('metValorHora').value = legajo.basico || '';
      legajoActual = legajo;
      const cli = await DB.getCliente($('metCliente').value);
      $('metLugar').value = (cli && cli.provincia) || '';
      $('metListaNoRem').innerHTML = '';
      actualizarAntiguedadPreview();
      $('metFormCard').style.display = 'block';
      $('metResultadoCard').style.display = 'none';
    });

    ['metHoras', 'metValorHora', 'metFechaPago', 'metImgr'].forEach(id => {
      $(id).addEventListener('input', actualizarAntiguedadPreview);
      $(id).addEventListener('change', actualizarAntiguedadPreview);
    });

    $('btnMetAddNoRem').addEventListener('click', agregarNoRem);
    $('btnMetCalcular').addEventListener('click', calcularYMostrar);
    $('btnMetGuardar').addEventListener('click', guardar);
    $('btnMetImprimir').addEventListener('click', imprimir);

    // Al entrar a la pantalla se cargan clientes e historial
    document.querySelector('[data-view="metalurgica"]').addEventListener('click', async () => {
      await poblarClientes();
      await renderHistorial();
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return { calcular, verRecibo, anular, PARAM, _renderRecibos: renderRecibos, _CSS: CSS_IMPRESION };
})();