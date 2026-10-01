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

const Calculos = {

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
}
