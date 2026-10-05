/* =========================================================
   calculos.js
   Motor de cálculo de la liquidación de haberes.
   Soporta 4 tipos de liquidación:
   - general / gastronomico  → básico mensual fijo
   - rural                   → básico = tarifa diaria x días trabajados,
                                permite cargar feriados (días x básico) y
                                antigüedad en % sobre (días trab. + feriados)
   - metalurgica             → igual que general, pero el período se
                                identifica por quincena (1° o 2°)
   Los % de aportes/contribuciones se leen de DB.getConfig() y son
   100% editables desde "Configuración".
========================================================= */

/* Porcentajes fijos de la liquidación METALÚRGICA (UOM).
   Si cambian por paritaria / normativa, se modifican acá. */
const METALURGICA = {
  antigPctPorAnio: 1,
  retenciones: {
    jubilacion: 11,        // sobre total remunerativo
    ley19032: 3,           // sobre total remunerativo
    obraSocial: 3,         // sobre remunerativo + no remunerativo
    cuotaSindical: 2.5     // sobre remunerativo + no remunerativo
  },
  contribuciones: {
    sipa: 10.77,           // sobre total remunerativo
    ley19032: 1.59,
    obraSocial: 6,
    asigFam: 4.7,
    fondoEmpleo: 0.94
  }
};

const Calculos = {

  /** Años completos entre la fecha de ingreso y el día de liquidación (YYYY-MM-DD). */
  aniosCompletos(ingresoIso, hastaIso) {
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
  },

  /**
   * Liquidación METALÚRGICA (UOM, quincenal por hora).
   * datos: { basico (valor hora), horas, imgr, seguroUom, ffepImporte,
   *          seguroVidaSepelio, fechaIngreso, fechaLiquidacion,
   *          remAdicionales, noRemAdicionales }
   */
  calcularMetalurgica(datos) {
    const P = METALURGICA;
    const valorHora = Number(datos.basico) || 0;
    const horas = Number(datos.horas) || 0;

    // Horas x básico por hora = remuneración base
    const basicoImporte = round2(horas * valorHora);

    // Antigüedad automática: años completos desde ingreso hasta liquidación x 1% x remuneración
    const anios = this.aniosCompletos(datos.fechaIngreso, datos.fechaLiquidacion);
    const antiguedadImporte = round2(basicoImporte * anios * P.antigPctPorAnio / 100);
    const antiguedadDetalle = anios + ' años x ' + P.antigPctPorAnio + '%';

    // IMGR: índice ingresado a mano menos (remuneración + antigüedad). Nunca negativo.
    const imgrTotal = round2(Number(datos.imgr) || 0);
    const sumaBase = round2(basicoImporte + antiguedadImporte);
    const imgrImporte = imgrTotal > 0 ? Math.max(0, round2(imgrTotal - sumaBase)) : 0;

    const remAdicionales = (datos.remAdicionales || []).map(r => ({ concepto: r.concepto, importe: round2(Number(r.importe) || 0) }));
    const noRemAdicionales = (datos.noRemAdicionales || []).map(r => ({ concepto: r.concepto, importe: round2(Number(r.importe) || 0) }));

    const totalRemunerativo = round2(sumaBase + imgrImporte + sum(remAdicionales.map(r => r.importe)));
    const totalNoRemunerativo = round2(sum(noRemAdicionales.map(r => r.importe)));
    const baseTotal = round2(totalRemunerativo + totalNoRemunerativo);

    // ---- Retenciones ----
    const descuentos = [
      { id: 'jubilacion', nombre: 'Jubilación', pct: P.retenciones.jubilacion, importe: round2(totalRemunerativo * P.retenciones.jubilacion / 100) },
      { id: 'ley19032', nombre: 'Ley 19.032 - INSSJP', pct: P.retenciones.ley19032, importe: round2(totalRemunerativo * P.retenciones.ley19032 / 100) },
      { id: 'obraSocial', nombre: 'Obra Social', pct: P.retenciones.obraSocial, importe: round2(baseTotal * P.retenciones.obraSocial / 100) },
      { id: 'cuotaSindical', nombre: 'Cuota sindical', pct: P.retenciones.cuotaSindical, importe: round2(baseTotal * P.retenciones.cuotaSindical / 100) }
    ];
    const seguroUom = round2(Number(datos.seguroUom) || 0);
    if (seguroUom > 0) descuentos.push({ id: 'seguroUom', nombre: 'Seguro UOM', pct: null, importe: seguroUom });
    const totalDescuentos = round2(sum(descuentos.map(d => d.importe)));

    const neto = round2(totalRemunerativo + totalNoRemunerativo - totalDescuentos);

    // ---- Contribuciones ----
    const cP = P.contribuciones;
    const contribuciones = [
      { id: 'sipa', nombre: 'SIPA - Ley 24.241', pct: cP.sipa },
      { id: 'ley19032', nombre: 'Ley 19.032 - INSSJP', pct: cP.ley19032 },
      { id: 'obraSocial', nombre: 'Obra Social', pct: cP.obraSocial },
      { id: 'asigFam', nombre: 'Asignaciones Familiares', pct: cP.asigFam },
      { id: 'fondoEmpleo', nombre: 'Fondo Nacional de Empleo', pct: cP.fondoEmpleo }
    ].map(x => ({ ...x, importe: round2(totalRemunerativo * x.pct / 100) }));

    const ffep = round2(Number(datos.ffepImporte) || 0);
    if (ffep > 0) contribuciones.push({ id: 'ffep', nombre: 'Riesgo de trabajo - FFEP', pct: null, importe: ffep });
    const seguroVida = round2(Number(datos.seguroVidaSepelio) || 0);
    if (seguroVida > 0) contribuciones.push({ id: 'seguroVida', nombre: 'Seguro de vida y sepelio', pct: null, importe: seguroVida });
    const totalContribuciones = round2(sum(contribuciones.map(c => c.importe)));

    return {
      modoUOM: true,
      tipoLiquidacion: 'metalurgica',
      basico: valorHora, horas, basicoImporte, diasTrabajados: 0,
      feriados: [], totalFeriados: 0,
      antiguedadImporte, antiguedadDetalle, anios,
      imgrTotal, imgrImporte,
      presentismoImporte: 0, aCuenta: 0,
      remAdicionales, noRemAdicionales,
      totalRemunerativo, totalNoRemunerativo,
      descuentos, totalDescuentos, neto,
      contribuciones, totalContribuciones,
      totalCargasSociales: round2(totalDescuentos + totalContribuciones)
    };
  },

  /**
   * Calcula la liquidación completa de un período.
   * datos = {
   *   tipoLiquidacion: 'general'|'rural'|'gastronomico'|'metalurgica',
   *   basico,                 // mensual (general/gastro/metalurgica) o tarifa diaria (rural)
   *   diasTrabajados,         // solo rural
   *   feriados: [{dias}],            // solo rural (importe se calcula = dias * básico diario)
   *   antigModo: 'automatico'|'manual',
   *   antigYears, antigPct,       // modo clásico (no rural)
   *   antigPctRural,              // modo rural: % sobre (básico por días + feriados)
   *   antigManualImporte,         // modo manual (cualquier tipo)
   *   presentismoPct, aCuenta,
   *   remAdicionales: [{concepto, importe}],   // cargados a mano
   *   noRemAdicionales: [{concepto, importe}]  // cargados a mano
   * }
   */
  calcular(datos) {
    if (datos.tipoLiquidacion === 'metalurgica') return this.calcularMetalurgica(datos);
    const config = DB.getConfig();
    const esRural = datos.tipoLiquidacion === 'rural';

    const basico = Number(datos.basico) || 0;
    const diasTrabajados = Number(datos.diasTrabajados) || 0;

    // ---- Básico efectivo (según tipo de liquidación) ----
    const basicoImporte = esRural ? round2(basico * diasTrabajados) : round2(basico);

    // ---- Feriados (solo rural): cada uno = dias * básico diario ----
    const feriados = (datos.feriados || []).map(f => ({
      dias: Number(f.dias) || 0,
      importe: round2((Number(f.dias) || 0) * basico)
    }));
    const totalFeriados = round2(sum(feriados.map(f => f.importe)));

    // ---- Antigüedad ----
    let antiguedadImporte = 0;
    let antiguedadDetalle = '';
    if (datos.antigModo === 'manual') {
      antiguedadImporte = round2(Number(datos.antigManualImporte) || 0);
      antiguedadDetalle = 'Importe manual';
    } else if (esRural) {
      const baseAntig = round2(basicoImporte + totalFeriados);
      const pct = Number(datos.antigPctRural) || 0;
      antiguedadImporte = round2(baseAntig * pct / 100);
      antiguedadDetalle = pct + '%';
    } else {
      const years = Number(datos.antigYears) || 0;
      const pct = Number(datos.antigPct) || 0;
      antiguedadImporte = round2(basicoImporte * (years * pct / 100));
      antiguedadDetalle = years + ' años x ' + pct + '%';
    }

    const presentismoImporte = round2(basicoImporte * ((Number(datos.presentismoPct) || 0) / 100));
    const aCuenta = Number(datos.aCuenta) || 0;

    const remAdicionales = (datos.remAdicionales || []).map(r => ({ concepto: r.concepto, importe: round2(Number(r.importe) || 0) }));
    const noRemAdicionales = (datos.noRemAdicionales || []).map(r => ({ concepto: r.concepto, importe: round2(Number(r.importe) || 0) }));

    const totalRemunerativo = round2(
      basicoImporte + antiguedadImporte + presentismoImporte + aCuenta +
      totalFeriados + sum(remAdicionales.map(r => r.importe))
    );
    const totalNoRemunerativo = round2(sum(noRemAdicionales.map(r => r.importe)));

    // -------- Descuentos (aportes del empleado) sobre el total remunerativo --------
    const descuentos = config.aportes.map(a => ({
      id: a.id,
      nombre: a.nombre,
      pct: a.pct,
      importe: round2(totalRemunerativo * (a.pct / 100))
    }));
    const totalDescuentos = round2(sum(descuentos.map(d => d.importe)));

    const neto = round2(totalRemunerativo + totalNoRemunerativo - totalDescuentos);

    // -------- Contribuciones patronales sobre el total remunerativo --------
    // ANSSAL/FSR y Contribución Obra Social permiten elegir el % a liquidar
    // (se pasan desde el formulario; si no se especifica, se usa el de config)
    const contribuciones = config.contribuciones.map(c => {
      let pct = c.pct;
      if (c.id === 'anssalFsr' && datos.anssalFsrPct !== undefined && datos.anssalFsrPct !== '') pct = Number(datos.anssalFsrPct);
      if (c.id === 'obraSocialContrib' && datos.obraSocialContribPct !== undefined && datos.obraSocialContribPct !== '') pct = Number(datos.obraSocialContribPct);
      return {
        id: c.id,
        nombre: c.nombre,
        pct,
        importe: round2(totalRemunerativo * (pct / 100))
      };
    });

    // FFEP: importe fijo cargado a mano (no es un porcentaje sobre el remunerativo)
    const ffepImporte = round2(Number(datos.ffepImporte) || 0);
    if (ffepImporte > 0) {
      contribuciones.push({ id: 'ffep', nombre: 'FFEP', pct: null, importe: ffepImporte });
    }

    const totalContribuciones = round2(sum(contribuciones.map(c => c.importe)));

    return {
      tipoLiquidacion: datos.tipoLiquidacion,
      basico, diasTrabajados, basicoImporte,
      feriados, totalFeriados,
      antiguedadImporte, antiguedadDetalle,
      presentismoImporte, aCuenta,
      remAdicionales, noRemAdicionales,
      totalRemunerativo, totalNoRemunerativo,
      descuentos, totalDescuentos,
      neto,
      contribuciones, totalContribuciones,
      totalCargasSociales: round2(totalDescuentos + totalContribuciones)
    };
  },

  /** Convierte un número a "son pesos: ... con ... centavos" */
  numeroALetras(num) {
    const entero = Math.floor(num);
    const centavos = Math.round((num - entero) * 100);
    return `${UNIDADES_A_LETRAS(entero)} con ${String(centavos).padStart(2, '0')}/100 centavos`;
  }
};

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function sum(arr) { return arr.reduce((a, b) => a + b, 0); }

/* ---- Conversor simple de número a letras (pesos argentinos) ---- */
function UNIDADES_A_LETRAS(n) {
  if (n === 0) return 'cero pesos';
  const UN = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
    'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte'];
  const DE = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  const CE = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

  function trescientos(num) {
    if (num === 0) return '';
    if (num === 100) return 'cien';
    let s = '';
    const c = Math.floor(num / 100), d = Math.floor((num % 100) / 10), u = num % 10;
    if (c) s += CE[c] + ' ';
    const resto = num % 100;
    if (resto <= 20) {
      s += UN[resto];
    } else if (d === 2) {
      s += 'veinti' + UN[u];
    } else {
      s += DE[d] + (u ? ' y ' + UN[u] : '');
    }
    return s.trim();
  }

  let resto = n;
  const millones = Math.floor(resto / 1000000); resto %= 1000000;
  const miles = Math.floor(resto / 1000); resto %= 1000;
  const cientos = resto;

  let partes = [];
  if (millones) partes.push(millones === 1 ? 'un millón' : trescientos(millones) + ' millones');
  if (miles) partes.push(miles === 1 ? 'mil' : trescientos(miles) + ' mil');
  if (cientos) partes.push(trescientos(cientos));

  return (partes.join(' ') || 'cero') + ' pesos';
}et partes = [];
  if (millones) partes.push(millones === 1 ? 'un millón' : trescientos(millones) + ' millones');
  if (miles) partes.push(miles === 1 ? 'mil' : trescientos(miles) + ' mil');
  if (cientos) partes.push(trescientos(cientos));

  return (partes.join(' ') || 'cero') + ' pesos';
}
