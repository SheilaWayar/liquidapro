/* =========================================================
   db.js
   Capa de datos de la app. Antes usaba localStorage; ahora todo
   se guarda en Supabase (Postgres en la nube), respetando Row
   Level Security: cada usuario logueado solo ve sus propios
   clientes/legajos/liquidaciones.

   OJO: todas las funciones ahora son ASYNC (devuelven promesas),
   porque hablan por red con la base. Por eso en app.js se usan
   con `await`.

   La configuración de aportes/contribuciones (%) sigue guardándose
   en localStorage: no es un dato sensible ni depende del cliente,
   así que no hacía falta llevarla a la nube.
========================================================= */

const CONFIG_DEFAULT = {
  aportes: [
    { id: 'jubilacion', nombre: 'Jubilación', pct: 11 },
    { id: 'ley19032', nombre: 'Ley 19.032 (INSSJP/PAMI)', pct: 3 },
    { id: 'obraSocial', nombre: 'Obra Social', pct: 3 },
    { id: 'faecys', nombre: 'FAECyS (cuota sindical)', pct: 0.5 },
  ],
  contribuciones: [
    { id: 'sipa', nombre: 'SIPA', pct: 10.77 },
    { id: 'pami', nombre: 'PAMI', pct: 1.59 },
    { id: 'fondoEmpleo', nombre: 'Fondo Nac. de Empleo', pct: 0.94 },
    { id: 'anssalFsr', nombre: 'ANSSAL / FSR', pct: 0.90, opciones: [0.6, 0.9] },
    { id: 'asigFam', nombre: 'Asignaciones Familiares', pct: 4.70 },
    { id: 'obraSocialContrib', nombre: 'Contribución Obra Social', pct: 5.10, opciones: [5.1, 5.4] },
    { id: 'art', nombre: 'ART', pct: 5.00 },
  ]
};

function _mostrarErrorSupabase(accion, error) {
  console.error(`Error en ${accion}:`, error);
  throw new Error(error.message || `Ocurrió un error al ${accion}.`);
}

/* ---- Mapeo entre columnas de la base (snake_case) y objetos JS (camelCase) ---- */
function mapCliente(row) {
  if (!row) return null;
  return {
    id: row.id, cuit: row.cuit, razonSocial: row.razon_social,
    domicilio: row.domicilio, provincia: row.provincia,
    bancoDefault: row.banco_default, estado: row.estado
  };
}
function mapLegajo(row) {
  if (!row) return null;
  return {
    id: row.id, clienteId: row.cliente_id, legajo: row.legajo, cuil: row.cuil,
    nombre: row.nombre, fechaIngreso: row.fecha_ingreso, tipoContrato: row.tipo_contrato,
    categoria: row.categoria, tarea: row.tarea, obraSocial: row.obra_social,
    cct: row.cct, banco: row.banco, basico: row.basico, estado: row.estado,
    fechaEgreso: row.fecha_egreso
  };
}
function mapLiquidacion(row) {
  if (!row) return null;
  return {
    id: row.id, clienteId: row.cliente_id, legajoId: row.legajo_id,
    periodo: row.periodo, periodoTexto: row.periodo_texto,
    tipoLiquidacion: row.tipo_liquidacion, quincenaTexto: row.quincena_texto,
    fechaPago: row.fecha_pago, resultado: row.resultado, estado: row.estado,
    creada: row.created_at
  };
}

const DB = {
  /* ---------------- CLIENTES ---------------- */
  async getClientes() {
    const { data, error } = await supabaseClient
      .from('clientes').select('*').eq('estado', 'activo').order('razon_social');
    if (error) _mostrarErrorSupabase('leer clientes', error);
    return (data || []).map(mapCliente);
  },

  async getCliente(id) {
    const { data, error } = await supabaseClient.from('clientes').select('*').eq('id', id).maybeSingle();
    if (error) _mostrarErrorSupabase('leer el cliente', error);
    return mapCliente(data);
  },

  async guardarCliente(cliente) {
    const payload = {
      cuit: cliente.cuit,
      razon_social: cliente.razonSocial,
      domicilio: cliente.domicilio,
      provincia: cliente.provincia,
      banco_default: cliente.bancoDefault
    };
    if (cliente.id) {
      const { data, error } = await supabaseClient
        .from('clientes').update(payload).eq('id', cliente.id).select().single();
      if (error) _mostrarErrorSupabase('guardar el cliente', error);
      return mapCliente(data);
    } else {
      const { data, error } = await supabaseClient
        .from('clientes').insert(payload).select().single();
      if (error) _mostrarErrorSupabase('crear el cliente', error);
      return mapCliente(data);
    }
  },

  /** Baja lógica (no se permite borrado físico en la base) */
  async eliminarCliente(id) {
    const { error } = await supabaseClient.from('clientes').update({ estado: 'baja' }).eq('id', id);
    if (error) _mostrarErrorSupabase('dar de baja el cliente', error);
  },

  /* ---------------- LEGAJOS ---------------- */
  async getLegajos() {
    const { data, error } = await supabaseClient
      .from('legajos_vista').select('*').eq('estado', 'activo').order('legajo');
    if (error) _mostrarErrorSupabase('leer legajos', error);
    return (data || []).map(mapLegajo);
  },

  async getLegajosPorCliente(clienteId) {
    const { data, error } = await supabaseClient
      .from('legajos_vista').select('*').eq('cliente_id', clienteId).eq('estado', 'activo').order('legajo');
    if (error) _mostrarErrorSupabase('leer legajos del cliente', error);
    return (data || []).map(mapLegajo);
  },

  async getLegajo(id) {
    const { data, error } = await supabaseClient.from('legajos_vista').select('*').eq('id', id).maybeSingle();
    if (error) _mostrarErrorSupabase('leer el legajo', error);
    return mapLegajo(data);
  },

  async guardarLegajo(legajo) {
    // El CUIL nunca viaja ni se guarda en texto plano: se encripta acá
    // mismo llamando a la función de Postgres antes del insert/update.
    const { data: cuilEnc, error: errEnc } = await supabaseClient.rpc('encrypt_cuit', { p_cuit: legajo.cuil });
    if (errEnc) _mostrarErrorSupabase('encriptar el CUIL', errEnc);

    const payload = {
      cliente_id: legajo.clienteId,
      legajo: legajo.legajo,
      cuil_enc: cuilEnc,
      nombre: legajo.nombre,
      fecha_ingreso: legajo.fechaIngreso || null,
      tipo_contrato: legajo.tipoContrato,
      categoria: legajo.categoria,
      tarea: legajo.tarea,
      obra_social: legajo.obraSocial,
      cct: legajo.cct,
      banco: legajo.banco,
      basico: legajo.basico || null
    };

    if (legajo.id) {
      const { error } = await supabaseClient.from('legajos').update(payload).eq('id', legajo.id);
      if (error) _mostrarErrorSupabase('guardar el legajo', error);
    } else {
      const { error } = await supabaseClient.from('legajos').insert(payload);
      if (error) _mostrarErrorSupabase('crear el legajo', error);
    }
  },

  /** Baja lógica (no se permite borrado físico en la base) */
  async eliminarLegajo(id) {
    const { error } = await supabaseClient.from('legajos').update({ estado: 'baja' }).eq('id', id);
    if (error) _mostrarErrorSupabase('dar de baja el legajo', error);
  },

  /* ---------------- LIQUIDACIONES ---------------- */
  async getLiquidaciones() {
    const { data, error } = await supabaseClient
      .from('liquidaciones').select('*').eq('estado', 'cerrada').order('created_at', { ascending: false });
    if (error) _mostrarErrorSupabase('leer liquidaciones', error);
    return (data || []).map(mapLiquidacion);
  },

  async getLiquidacionesPorLegajo(legajoId) {
    const { data, error } = await supabaseClient
      .from('liquidaciones').select('*').eq('legajo_id', legajoId).eq('estado', 'cerrada')
      .order('created_at', { ascending: false });
    if (error) _mostrarErrorSupabase('leer liquidaciones del legajo', error);
    return (data || []).map(mapLiquidacion);
  },

  async guardarLiquidacion(liq) {
    const { data: sesion } = await supabaseClient.auth.getSession();
    const payload = {
      cliente_id: liq.clienteId,
      legajo_id: liq.legajoId,
      periodo: liq.periodo,
      periodo_texto: liq.periodoTexto,
      tipo_liquidacion: liq.tipoLiquidacion,
      quincena_texto: liq.quincenaTexto || null,
      fecha_pago: liq.fechaPago || null,
      resultado: liq.resultado,
      creada_por: sesion?.session?.user?.id || null
    };
    const { data, error } = await supabaseClient.from('liquidaciones').insert(payload).select().single();
    if (error) _mostrarErrorSupabase('guardar la liquidación', error);
    return mapLiquidacion(data);
  },

  /** No se borra: se marca como anulada (comprobante legal inmutable) */
  async eliminarLiquidacion(id) {
    const { error } = await supabaseClient.from('liquidaciones').update({ estado: 'anulada' }).eq('id', id);
    if (error) _mostrarErrorSupabase('anular la liquidación', error);
  },

  /* ---------------- CONFIGURACIÓN (aportes/contribuciones) ----------------
     Se mantiene en localStorage: no es un dato sensible ni depende del
     cliente logueado, así que no hacía falta llevarla a la nube. */
  getConfig() {
    try {
      const raw = localStorage.getItem('lp_config');
      const c = raw ? JSON.parse(raw) : null;
      return c || JSON.parse(JSON.stringify(CONFIG_DEFAULT));
    } catch (e) {
      return JSON.parse(JSON.stringify(CONFIG_DEFAULT));
    }
  },
  guardarConfig(config) {
    localStorage.setItem('lp_config', JSON.stringify(config));
  },
  resetConfig() {
    const def = JSON.parse(JSON.stringify(CONFIG_DEFAULT));
    localStorage.setItem('lp_config', JSON.stringify(def));
    return def;
  }
};
