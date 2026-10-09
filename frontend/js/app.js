/* =========================================================
   app.js
   Controla el login, la navegación entre vistas, los formularios
   (modales), las tablas y el flujo completo de liquidación + recibo.

   Como db.js ahora habla con Supabase por red, casi todas las
   funciones de acá son `async` y usan `await DB....`.
========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  initLogin();
});

/* =========================================================
   LOGIN (Supabase Auth)
========================================================= */
function initLogin() {
  const form = document.getElementById('formLogin');
  const btnRegistrarse = document.getElementById('btnRegistrarse');
  const btnCerrarSesion = document.getElementById('btnCerrarSesion');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    mostrarErrorLogin('');
    try {
      await Auth.iniciarSesion(email, password);
      // onCambioSesion (más abajo) se encarga de mostrar la app
    } catch (err) {
      mostrarErrorLogin(err.message || 'No se pudo iniciar sesión.');
    }
  });

  btnRegistrarse.addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) { mostrarErrorLogin('Completá email y contraseña para registrarte.'); return; }
    mostrarErrorLogin('');
    try {
      await Auth.registrarse(email, password);
      mostrarErrorLogin('Cuenta creada. Revisá tu email si tu proyecto pide confirmación, o iniciá sesión directamente.', true);
    } catch (err) {
      mostrarErrorLogin(err.message || 'No se pudo crear la cuenta.');
    }
  });

  btnCerrarSesion.addEventListener('click', async () => {
    await Auth.cerrarSesion();
  });

  Auth.onCambioSesion((session) => {
    if (session) {
      mostrarApp(session);
    } else {
      mostrarLogin();
    }
  });

  // Chequeo inicial (por si ya había una sesión guardada en el navegador)
  Auth.obtenerSesion().then((session) => {
    if (session) mostrarApp(session); else mostrarLogin();
  });
}

function mostrarErrorLogin(msg, esOk) {
  const el = document.getElementById('loginError');
  el.textContent = msg || '';
  el.style.color = esOk ? 'var(--verde)' : 'var(--rojo)';
}

function mostrarLogin() {
  document.getElementById('pantallaLogin').style.display = 'flex';
  document.getElementById('appShell').style.display = 'none';
}

let appYaInicializada = false;

function mostrarApp(session) {
  document.getElementById('pantallaLogin').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';
  document.getElementById('emailUsuario').textContent = session.user.email;

  if (!appYaInicializada) {
    appYaInicializada = true;
    initNavegacion();
    initClientes();
    initLegajos();
    initLiquidaciones();
    initConfiguracion();
    actualizarDashboard();
  }
}

/* =========================================================
   NAVEGACIÓN
========================================================= */
function initNavegacion() {
  document.querySelectorAll('.menu-item').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.menu-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
      if (btn.dataset.view === 'dashboard') await actualizarDashboard();
      if (btn.dataset.view === 'clientes') await renderClientes();
      if (btn.dataset.view === 'legajos') { await poblarSelectClientesFiltro(); await renderLegajos(); }
      if (btn.dataset.view === 'liquidaciones') { await poblarSelectClientesLiquidacion(); await renderHistorialLiquidaciones(); }
      if (btn.dataset.view === 'configuracion') renderConfiguracion();
    });
  });
}

function money(n) {
  return '$ ' + (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fechaAR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function abrirModal(html) {
  document.getElementById('modalBox').innerHTML = html;
  document.getElementById('modalOverlay').classList.add('active');
}
function cerrarModal() {
  document.getElementById('modalOverlay').classList.remove('active');
}
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'modalOverlay') cerrarModal();
});
function mostrarErrorEnPantalla(err) {
  console.error(err);
  alert(err.message || 'Ocurrió un error inesperado.');
}

/* =========================================================
   DASHBOARD
========================================================= */
async function actualizarDashboard() {
  try {
    const [clientes, legajos, liqs] = await Promise.all([
      DB.getClientes(), DB.getLegajos(), DB.getLiquidaciones()
    ]);

    document.getElementById('statClientes').textContent = clientes.length;
    document.getElementById('statLegajos').textContent = legajos.length;
    document.getElementById('statLiquidaciones').textContent = liqs.length;

    const hoy = new Date();
    document.getElementById('statMesActual').textContent =
      hoy.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

    const tbody = document.querySelector('#tablaUltimasLiq tbody');
    tbody.innerHTML = '';
    const ultimas = liqs.slice(0, 6);
    document.getElementById('msgSinLiq').style.display = ultimas.length ? 'none' : 'block';

    for (const l of ultimas) {
      const cliente = clientes.find(c => c.id === l.clienteId) || await DB.getCliente(l.clienteId);
      const legajo = legajos.find(x => x.id === l.legajoId) || await DB.getLegajo(l.legajoId);
      tbody.innerHTML += `<tr>
        <td>${new Date(l.creada).toLocaleDateString('es-AR')}</td>
        <td>${cliente ? cliente.razonSocial : '—'}</td>
        <td>${legajo ? legajo.nombre : '—'}</td>
        <td>${l.periodoTexto}</td>
        <td>${money(l.resultado.neto)}</td>
        <td><button class="btn-icon" title="Ver recibo" onclick="verReciboGuardado('${l.id}')">👁️</button></td>
      </tr>`;
    }
  } catch (err) { mostrarErrorEnPantalla(err); }
}

/* =========================================================
   CLIENTES
========================================================= */
function initClientes() {
  document.getElementById('btnNuevoCliente').addEventListener('click', () => abrirFormCliente());
  document.getElementById('buscarCliente').addEventListener('input', renderClientes);
  renderClientes();
}

async function renderClientes() {
  try {
    const filtro = (document.getElementById('buscarCliente').value || '').toLowerCase();
    const todos = await DB.getClientes();
    const clientes = todos.filter(c =>
      c.razonSocial.toLowerCase().includes(filtro) || c.cuit.includes(filtro));
    const tbody = document.getElementById('tablaClientes');
    tbody.innerHTML = '';
    document.getElementById('msgSinClientes').style.display = clientes.length ? 'none' : 'block';

    for (const c of clientes) {
      const legajosCliente = await DB.getLegajosPorCliente(c.id);
      tbody.innerHTML += `<tr>
        <td><strong>${c.razonSocial}</strong></td>
        <td>${c.cuit}</td>
        <td>${c.domicilio || '—'}</td>
        <td>${legajosCliente.length}</td>
        <td>
          <button class="btn-icon" title="Editar" onclick="abrirFormCliente('${c.id}')">✏️</button>
          <button class="btn-icon" title="Dar de baja" onclick="confirmarEliminarCliente('${c.id}')">🗑️</button>
        </td>
      </tr>`;
    }
  } catch (err) { mostrarErrorEnPantalla(err); }
}

async function abrirFormCliente(id) {
  const c = id ? await DB.getCliente(id) : { razonSocial: '', cuit: '', domicilio: '', provincia: '', bancoDefault: '' };
  abrirModal(`
    <h3>${id ? 'Editar' : 'Nuevo'} cliente</h3>
    <div class="form-row"><label>Razón social</label>
      <input class="input" id="fRazonSocial" value="${c.razonSocial}"></div>
    <div class="form-row"><label>C.U.I.T.</label>
      <input class="input" id="fCuit" value="${c.cuit}" placeholder="30-11111111-4"></div>
    <div class="form-row"><label>Domicilio</label>
      <input class="input" id="fDomicilio" value="${c.domicilio || ''}"></div>
    <div class="form-row"><label>Provincia</label>
      <input class="input" id="fProvincia" value="${c.provincia || ''}"></div>
    <div class="form-row"><label>Banco (por defecto para el pago)</label>
      <input class="input" id="fBanco" value="${c.bancoDefault || ''}"></div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="cerrarModal()">Cancelar</button>
      <button class="btn-primary" onclick="guardarCliente('${id || ''}')">Guardar</button>
    </div>
  `);
}

async function guardarCliente(id) {
  try {
    const razonSocial = document.getElementById('fRazonSocial').value.trim();
    const cuit = document.getElementById('fCuit').value.trim();
    if (!razonSocial || !cuit) { alert('Razón social y CUIT son obligatorios.'); return; }
    const cliente = {
      id: id || undefined,
      razonSocial, cuit,
      domicilio: document.getElementById('fDomicilio').value.trim(),
      provincia: document.getElementById('fProvincia').value.trim(),
      bancoDefault: document.getElementById('fBanco').value.trim()
    };
    await DB.guardarCliente(cliente);
    cerrarModal();
    await renderClientes();
    await actualizarDashboard();
  } catch (err) { mostrarErrorEnPantalla(err); }
}

async function confirmarEliminarCliente(id) {
  if (confirm('¿Dar de baja este cliente? No se borra físicamente: queda inactivo pero se conserva todo su historial (requisito legal).')) {
    try {
      await DB.eliminarCliente(id);
      await renderClientes();
      await actualizarDashboard();
    } catch (err) { mostrarErrorEnPantalla(err); }
  }
}

/* =========================================================
   LEGAJOS
========================================================= */
function initLegajos() {
  document.getElementById('btnNuevoLegajo').addEventListener('click', () => abrirFormLegajo());
  document.getElementById('buscarLegajo').addEventListener('input', renderLegajos);
  document.getElementById('filtroClienteLegajo').addEventListener('change', renderLegajos);
  poblarSelectClientesFiltro();
  renderLegajos();
}

async function poblarSelectClientesFiltro() {
  const sel = document.getElementById('filtroClienteLegajo');
  const actual = sel.value;
  const clientes = await DB.getClientes();
  sel.innerHTML = '<option value="">Todos los clientes</option>' +
    clientes.map(c => `<option value="${c.id}">${c.razonSocial}</option>`).join('');
  sel.value = actual;
}

async function renderLegajos() {
  try {
    const filtroTexto = (document.getElementById('buscarLegajo').value || '').toLowerCase();
    const filtroCliente = document.getElementById('filtroClienteLegajo').value;
    const [legajosTodos, clientes] = await Promise.all([
      filtroCliente ? DB.getLegajosPorCliente(filtroCliente) : DB.getLegajos(),
      DB.getClientes()
    ]);
    let legajos = legajosTodos;
    if (filtroTexto) legajos = legajos.filter(l =>
      l.nombre.toLowerCase().includes(filtroTexto) ||
      (l.cuil || '').includes(filtroTexto) ||
      String(l.legajo).includes(filtroTexto));

    const tbody = document.getElementById('tablaLegajos');
    tbody.innerHTML = '';
    document.getElementById('msgSinLegajos').style.display = legajos.length ? 'none' : 'block';

    legajos.forEach(l => {
      const cliente = clientes.find(c => c.id === l.clienteId);
      tbody.innerHTML += `<tr>
        <td>${l.legajo}</td>
        <td><strong>${l.nombre}</strong></td>
        <td>${l.cuil}</td>
        <td>${cliente ? cliente.razonSocial : '—'}</td>
        <td>${l.categoria || '—'}</td>
        <td>${fechaAR(l.fechaIngreso)}</td>
        <td>
          <button class="btn-icon" title="Editar" onclick="abrirFormLegajo('${l.id}')">✏️</button>
          <button class="btn-icon" title="Dar de baja" onclick="confirmarEliminarLegajo('${l.id}')">🗑️</button>
        </td>
      </tr>`;
    });
  } catch (err) { mostrarErrorEnPantalla(err); }
}

async function abrirFormLegajo(id) {
  const clientes = await DB.getClientes();
  if (!clientes.length) { alert('Primero tenés que cargar al menos un cliente.'); return; }
  const l = id ? await DB.getLegajo(id) : {
    clienteId: '', legajo: '', nombre: '', cuil: '', tipoContrato: 'Por tiempo indeterminado',
    obraSocial: '', cct: '', fechaIngreso: '', categoria: '', tarea: '', banco: '', basico: ''
  };
  // Tipo de trabajador (se guarda en el campo "tipo de contrato"): los legajos viejos "Por tiempo indeterminado" son permanentes
  const esPermanente = !l.tipoContrato || /indeterminado|^\s*permanente/i.test(l.tipoContrato);
  // Legajo RURAL: se reconoce por la Actividad "Trabajador agrario Ley 26.727" (se guarda en el campo C.C.T.)
  const esRural = /26\.?727|agrario/i.test(l.cct || '');
  abrirModal(`
    <h3>${id ? 'Editar' : 'Nuevo'} legajo</h3>
    <div class="form-row"><label>Cliente (empleador)</label>
      <select class="input" id="fClienteId">
        ${clientes.map(c => `<option value="${c.id}" ${c.id === l.clienteId ? 'selected' : ''}>${c.razonSocial}</option>`).join('')}
      </select>
    </div>
    <div class="form-row"><label>Categoría de liquidación</label>
      <select class="input" id="fEsRural" onchange="alternarCamposRural()">
        <option value="no" ${esRural ? '' : 'selected'}>Otra categoría (Mensual / Gastronómico / Metalúrgica)</option>
        <option value="si" ${esRural ? 'selected' : ''}>Rural</option>
      </select>
    </div>
    <div class="grid-2">
      <div><label>Legajo N°</label><input class="input" id="fLegajoNum" value="${l.legajo}"></div>
      <div><label>C.U.I.L.</label><input class="input" id="fCuil" value="${l.cuil}" placeholder="20-11111111-1"></div>
    </div>
    <div class="form-row"><label>Apellido y nombre</label><input class="input" id="fNombre" value="${l.nombre}"></div>
    <div class="grid-2">
      <div><label>Fecha de ingreso</label><input class="input" type="date" id="fFechaIngreso" value="${l.fechaIngreso || ''}"></div>
      <div><label>Tipo de trabajador</label>
        <select class="input" id="fTipoContrato">
          <option value="Permanente" ${esPermanente ? 'selected' : ''}>Permanente</option>
          <option value="No permanente" ${esPermanente ? '' : 'selected'}>No permanente</option>
        </select>
      </div>
    </div>
    <div class="grid-2">
      <div><label>Categoría</label><input class="input" id="fCategoria" value="${l.categoria || ''}"></div>
      <div><label id="lblTarea">${esRural ? 'Modalidad de contratación' : 'Tarea desempeñada'}</label>
        <input class="input" id="fTarea" value="${l.tarea || ''}" ${esRural ? 'list="listaModalidades"' : ''}>
        <datalist id="listaModalidades">
          <option value="Trabajador permanente de prestación continua">
          <option value="Trabajador permanente discontinuo">
          <option value="Trabajador temporario">
          <option value="Contratado por equipo o cuadrilla familiar">
        </datalist>
      </div>
    </div>
    <div class="grid-2">
      <div><label>Obra Social</label><input class="input" id="fObraSocial" value="${l.obraSocial || ''}"></div>
      <div id="fWrapCct" style="display:${esRural ? 'none' : 'block'}"><label>C.C.T.</label><input class="input" id="fCct" value="${esRural ? '' : (l.cct || '')}" placeholder="130/75"></div>
      <div id="fWrapActividad" style="display:${esRural ? 'block' : 'none'}"><label>Actividad</label><input class="input" id="fActividad" value="${ACTIVIDAD_RURAL}" readonly></div>
    </div>
    <div class="grid-2">
      <div><label>Banco de pago</label><input class="input" id="fBancoPago" value="${l.banco || ''}"></div>
      <div><label>Remuneración básica de referencia ($)</label><input class="input" type="number" step="0.01" id="fBasico" value="${l.basico || ''}"></div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="cerrarModal()">Cancelar</button>
      <button class="btn-primary" onclick="guardarLegajo('${id || ''}')">Guardar</button>
    </div>
  `);
}

const ACTIVIDAD_RURAL = 'Trabajador agrario Ley 26.727';

/** Legajo rural: "Tarea desempeñada" pasa a ser "Modalidad de contratación" y aparece la Actividad */
function alternarCamposRural() {
  const rural = document.getElementById('fEsRural').value === 'si';
  document.getElementById('lblTarea').textContent = rural ? 'Modalidad de contratación' : 'Tarea desempeñada';
  const t = document.getElementById('fTarea');
  if (rural) t.setAttribute('list', 'listaModalidades'); else t.removeAttribute('list');
  document.getElementById('fWrapCct').style.display = rural ? 'none' : 'block';
  document.getElementById('fWrapActividad').style.display = rural ? 'block' : 'none';
}

async function guardarLegajo(id) {
  try {
    const nombre = document.getElementById('fNombre').value.trim();
    const cuil = document.getElementById('fCuil').value.trim();
    const legajoNum = document.getElementById('fLegajoNum').value.trim();
    if (!nombre || !cuil || !legajoNum) { alert('Nombre, CUIL y N° de legajo son obligatorios.'); return; }
    const legajo = {
      id: id || undefined,
      clienteId: document.getElementById('fClienteId').value,
      legajo: legajoNum,
      nombre, cuil,
      fechaIngreso: document.getElementById('fFechaIngreso').value,
      tipoContrato: document.getElementById('fTipoContrato').value.trim(),
      categoria: document.getElementById('fCategoria').value.trim(),
      tarea: document.getElementById('fTarea').value.trim(),
      obraSocial: document.getElementById('fObraSocial').value.trim(),
      cct: document.getElementById('fEsRural').value === 'si' ? ACTIVIDAD_RURAL : document.getElementById('fCct').value.trim(),
      banco: document.getElementById('fBancoPago').value.trim(),
      basico: document.getElementById('fBasico').value
    };
    await DB.guardarLegajo(legajo);
    cerrarModal();
    await renderLegajos();
    await actualizarDashboard();
  } catch (err) { mostrarErrorEnPantalla(err); }
}

async function confirmarEliminarLegajo(id) {
  if (confirm('¿Dar de baja este legajo? No se borra físicamente: queda inactivo pero se conserva su historial de liquidaciones (requisito legal).')) {
    try {
      await DB.eliminarLegajo(id);
      await renderLegajos();
      await actualizarDashboard();
    } catch (err) { mostrarErrorEnPantalla(err); }
  }
}

/* =========================================================
   LIQUIDACIONES
========================================================= */
let remCount = 0, noRemCount = 0, feriadoCount = 0;

function initLiquidaciones() {
  poblarSelectClientesLiquidacion();

  document.getElementById('selCliente').addEventListener('change', async (e) => {
    const selLegajo = document.getElementById('selLegajo');
    const legajos = e.target.value ? await DB.getLegajosPorCliente(e.target.value) : [];
    selLegajo.innerHTML = '<option value="">Seleccionar legajo...</option>' +
      legajos.map(l => `<option value="${l.id}">${l.legajo} - ${l.nombre}</option>`).join('');
    selLegajo.disabled = !e.target.value;
    ocultarFormLiquidacion();
  });

  document.getElementById('selLegajo').addEventListener('change', async (e) => {
    if (!e.target.value) { ocultarFormLiquidacion(); return; }
    const legajo = await DB.getLegajo(e.target.value);
    document.getElementById('liqBasico').value = legajo.basico || '';
    const years = legajo.fechaIngreso ? calcularAntiguedadAnios(legajo.fechaIngreso) : 0;
    document.getElementById('liqAntigYears').value = years;
    document.getElementById('formLiquidacionCard').style.display = 'block';
    document.getElementById('resultadoLiqCard').style.display = 'none';
  });

  document.getElementById('liqTipo').addEventListener('change', aplicarTipoLiquidacionUI);
  document.getElementById('liqAntigModo').addEventListener('change', aplicarModoAntiguedadUI);
  aplicarTipoLiquidacionUI();
  aplicarModoAntiguedadUI();
  precargarContribucionesEspeciales();

  document.getElementById('btnAddRem').addEventListener('click', () => agregarFilaConcepto('listaRemAdic', 'rem'));
  document.getElementById('btnAddNoRem').addEventListener('click', () => agregarFilaConcepto('listaNoRemAdic', 'norem'));
  document.getElementById('btnAddFeriado').addEventListener('click', agregarFilaFeriado);

  document.getElementById('btnCalcular').addEventListener('click', calcularYMostrarRecibo);
  document.getElementById('btnGuardarLiq').addEventListener('click', guardarLiquidacionActual);
  document.getElementById('btnImprimir').addEventListener('click', () => window.print());

  renderHistorialLiquidaciones();
}

/* Muestra/oculta campos según el tipo de liquidación elegido */
function aplicarTipoLiquidacionUI() {
  const tipo = document.getElementById('liqTipo').value;
  const esRural = tipo === 'rural';
  const esMetalurgica = tipo === 'metalurgica';

  document.getElementById('wrapDiasTrabajados').style.display = esRural ? 'block' : 'none';
  document.getElementById('btnAddFeriado').style.display = esRural ? 'inline-block' : 'none';
  document.getElementById('wrapQuincena').style.display = esMetalurgica ? 'block' : 'none';

  document.getElementById('labelBasico').textContent = esRural
    ? 'Remuneración básica diaria / jornal ($)'
    : 'Remuneración básica ($)';

  document.getElementById('wrapAntigYears').style.display = esRural ? 'none' : 'block';
  document.getElementById('wrapAntigPct').style.display = esRural ? 'none' : 'block';
  document.getElementById('wrapAntigPctRural').style.display = esRural ? 'block' : 'none';

  aplicarModoAntiguedadUI();
}

function aplicarModoAntiguedadUI() {
  const modo = document.getElementById('liqAntigModo').value;
  const esRural = document.getElementById('liqTipo').value === 'rural';
  const manual = modo === 'manual';

  document.getElementById('wrapAntigManual').style.display = manual ? 'block' : 'none';
  document.getElementById('wrapAntigYears').style.display = (!manual && !esRural) ? 'block' : 'none';
  document.getElementById('wrapAntigPct').style.display = (!manual && !esRural) ? 'block' : 'none';
  document.getElementById('wrapAntigPctRural').style.display = (!manual && esRural) ? 'block' : 'none';
}

function precargarContribucionesEspeciales() {
  const config = DB.getConfig();
  const anssal = config.contribuciones.find(c => c.id === 'anssalFsr');
  const obraSocial = config.contribuciones.find(c => c.id === 'obraSocialContrib');
  if (anssal) document.getElementById('liqAnssalPct').value = String(anssal.pct);
  if (obraSocial) document.getElementById('liqObraSocialContribPct').value = String(obraSocial.pct);
}

function ocultarFormLiquidacion() {
  document.getElementById('formLiquidacionCard').style.display = 'none';
  document.getElementById('resultadoLiqCard').style.display = 'none';
}

async function poblarSelectClientesLiquidacion() {
  const sel = document.getElementById('selCliente');
  const actual = sel.value;
  const clientes = await DB.getClientes();
  sel.innerHTML = '<option value="">Seleccionar cliente...</option>' +
    clientes.map(c => `<option value="${c.id}">${c.razonSocial}</option>`).join('');
  sel.value = actual;
}

function calcularAntiguedadAnios(fechaIngresoIso) {
  const ingreso = new Date(fechaIngresoIso);
  const hoy = new Date();
  let years = hoy.getFullYear() - ingreso.getFullYear();
  const m = hoy.getMonth() - ingreso.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < ingreso.getDate())) years--;
  return Math.max(0, years);
}

/* ---- Filas de conceptos cargados a mano (remunerativos / no remunerativos) ---- */
function agregarFilaConcepto(contenedorId, tipo) {
  const idx = tipo === 'rem' ? remCount++ : noRemCount++;
  const rowId = `${tipo}-${idx}`;
  const div = document.createElement('div');
  div.className = 'fila-concepto';
  div.id = 'fila-' + rowId;
  div.innerHTML = `
    <input class="input concepto-nombre" placeholder="Concepto (a elección)">
    <input class="input concepto-importe" type="number" step="0.01" placeholder="Importe">
    <button class="btn-icon" title="Quitar" onclick="document.getElementById('fila-${rowId}').remove()">✖</button>
  `;
  document.getElementById(contenedorId).appendChild(div);
}

function leerFilasConcepto(contenedorId) {
  const filas = document.querySelectorAll(`#${contenedorId} .fila-concepto`);
  const out = [];
  filas.forEach(f => {
    const concepto = f.querySelector('.concepto-nombre').value.trim();
    const importe = f.querySelector('.concepto-importe').value;
    if (concepto && importe) out.push({ concepto, importe });
  });
  return out;
}

/* ---- Fila especial de Feriados (solo Rural): días x básico ---- */
function agregarFilaFeriado() {
  const rowId = 'feriado-' + (feriadoCount++);
  const div = document.createElement('div');
  div.className = 'fila-feriado';
  div.id = 'fila-' + rowId;
  div.innerHTML = `
    <span>🎌 Feriados trabajados</span>
    <input class="input feriado-dias" type="number" step="1" min="0" placeholder="Cant. días" oninput="actualizarImporteFeriado('${rowId}')">
    <input class="input solo-lectura feriado-importe" type="text" readonly value="${money(0)}">
    <button class="btn-icon" title="Quitar" onclick="document.getElementById('fila-${rowId}').remove()">✖</button>
  `;
  document.getElementById('listaRemAdic').appendChild(div);
}

function actualizarImporteFeriado(rowId) {
  const fila = document.getElementById('fila-' + rowId);
  const dias = Number(fila.querySelector('.feriado-dias').value) || 0;
  const basico = Number(document.getElementById('liqBasico').value) || 0;
  fila.querySelector('.feriado-importe').value = money(dias * basico);
}

function leerFeriados() {
  const filas = document.querySelectorAll('#listaRemAdic .fila-feriado');
  const out = [];
  filas.forEach(f => {
    const dias = Number(f.querySelector('.feriado-dias').value) || 0;
    if (dias > 0) out.push({ dias });
  });
  return out;
}

function leerRemAdicionalesManuales() {
  const filas = document.querySelectorAll('#listaRemAdic .fila-concepto');
  const out = [];
  filas.forEach(f => {
    const concepto = f.querySelector('.concepto-nombre').value.trim();
    const importe = f.querySelector('.concepto-importe').value;
    if (concepto && importe) out.push({ concepto, importe });
  });
  return out;
}

let liquidacionActualContexto = null;

async function calcularYMostrarRecibo() {
  try {
    const clienteId = document.getElementById('selCliente').value;
    const legajoId = document.getElementById('selLegajo').value;
    const periodo = document.getElementById('selPeriodo').value;
    const fechaPago = document.getElementById('selFechaPago').value;

    if (!clienteId || !legajoId || !periodo) {
      alert('Completá cliente, legajo y período antes de calcular.');
      return;
    }

    const tipoLiquidacion = document.getElementById('liqTipo').value;
    const quincena = document.getElementById('liqQuincena').value;
    const antigModo = document.getElementById('liqAntigModo').value;

    const datos = {
      tipoLiquidacion,
      basico: document.getElementById('liqBasico').value,
      diasTrabajados: document.getElementById('liqDiasTrabajados').value,
      feriados: leerFeriados(),
      antigModo,
      antigYears: document.getElementById('liqAntigYears').value,
      antigPct: document.getElementById('liqAntigPct').value,
      antigPctRural: document.getElementById('liqAntigPctRural').value,
      antigManualImporte: document.getElementById('liqAntigManualImporte').value,
      presentismoPct: document.getElementById('liqPresentismoPct').value,
      aCuenta: document.getElementById('liqACuenta').value,
      anssalFsrPct: document.getElementById('liqAnssalPct').value,
      obraSocialContribPct: document.getElementById('liqObraSocialContribPct').value,
      ffepImporte: document.getElementById('liqFfepImporte').value,
      remAdicionales: leerRemAdicionalesManuales(),
      noRemAdicionales: leerFilasConcepto('listaNoRemAdic')
    };

    const resultado = Calculos.calcular(datos);
    const [cliente, legajo] = await Promise.all([DB.getCliente(clienteId), DB.getLegajo(legajoId)]);

    const [anio, mes] = periodo.split('-');
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const periodoTexto = `${meses[parseInt(mes, 10) - 1].toUpperCase()} ${anio}`;
    const quincenaTexto = quincena === '1' ? 'Primera quincena' : 'Segunda quincena';

    liquidacionActualContexto = {
      clienteId, legajoId, periodo, periodoTexto, fechaPago,
      tipoLiquidacion, quincenaTexto, resultado
    };

    document.getElementById('reciboContainer').innerHTML =
      renderRecibo(cliente, legajo, liquidacionActualContexto, resultado);
    document.getElementById('resultadoLiqCard').style.display = 'block';
    document.getElementById('resultadoLiqCard').scrollIntoView({ behavior: 'smooth' });
  } catch (err) { mostrarErrorEnPantalla(err); }
}

function actualizarBasicoDesdeRecibo(valor) {
  document.getElementById('liqBasico').value = valor;
  document.querySelectorAll('#listaRemAdic .fila-feriado').forEach(f => {
    const rowId = f.id.replace('fila-', '');
    actualizarImporteFeriado(rowId);
  });
  calcularYMostrarRecibo();
}

function renderRecibo(cliente, legajo, ctx, r) {
  const esRural = ctx.tipoLiquidacion === 'rural';
  const esMetalurgica = ctx.tipoLiquidacion === 'metalurgica';

  const labelPeriodo = esMetalurgica ? 'Quincena abonada' : 'Período abonado';
  const valorPeriodo = esMetalurgica ? `${ctx.quincenaTexto} de ${ctx.periodoTexto}` : ctx.periodoTexto;

  let filasBasico = '';
  if (esRural) {
    filasBasico = `
      <tr><td>Básico (tarifa diaria)</td><td class="num">$/día</td><td class="num"></td><td class="num"></td><td class="num"></td></tr>
      <tr><td>Cantidad de días trabajados</td><td class="num">${r.diasTrabajados}</td><td class="num">${money(r.basicoImporte)}</td><td class="num"></td><td class="num"></td></tr>`;
  } else {
    filasBasico = `<tr><td>Básico</td><td class="num"></td><td class="num">${money(r.basicoImporte)}</td><td class="num"></td><td class="num"></td></tr>`;
  }

  const filasFeriados = (r.feriados || []).map(f =>
    `<tr><td>Feriados trabajados</td><td class="num">${f.dias}</td><td class="num">${money(f.importe)}</td><td class="num"></td><td class="num"></td></tr>`).join('');

  const filasRem = r.remAdicionales.map(c => `<tr><td>${c.concepto}</td><td class="num"></td><td class="num">${money(c.importe)}</td><td class="num"></td><td class="num"></td></tr>`).join('');
  const filasNoRem = r.noRemAdicionales.map(c => `<tr><td>${c.concepto}</td><td class="num"></td><td class="num"></td><td class="num">${money(c.importe)}</td><td class="num"></td></tr>`).join('');
  const filasDescuentos = r.descuentos.map(d => `<tr><td>${d.nombre}</td><td class="num">${d.pct}%</td><td class="num"></td><td class="num"></td><td class="num">${money(d.importe)}</td></tr>`).join('');
  const filasContrib = r.contribuciones.map(c =>
    `<tr><td>${c.nombre}</td><td class="num">${c.pct !== null && c.pct !== undefined ? c.pct + '%' : 'Manual'}</td><td class="num">${money(c.importe)}</td></tr>`).join('');

  return `
  <div class="recibo" id="reciboImprimible">
    <div class="recibo-titulo">RECIBO DE HABERES LEY 20.744</div>
    <div class="recibo-empresa">
      <div class="razon">${cliente.razonSocial}</div>
      <div>C.U.I.T: ${cliente.cuit}</div>
      <div>${cliente.domicilio || ''} ${cliente.provincia ? '- ' + cliente.provincia : ''}</div>
    </div>
    <div class="recibo-grid cols-2">
      <div><div class="label">${labelPeriodo}</div><div class="valor">${valorPeriodo}</div></div>
      <div><div class="label">Legajo N°</div><div class="valor">${legajo.legajo}</div></div>
    </div>
    <div class="recibo-grid cols-2">
      <div><div class="label">Apellido y nombre</div><div class="valor">${legajo.nombre}</div></div>
      <div><div class="label">C.U.I.L. empleado</div><div class="valor">${legajo.cuil}</div></div>
    </div>
    <div class="recibo-grid cols-3">
      <div><div class="label">Tipo de contrato</div><div class="valor">${legajo.tipoContrato || '—'}</div></div>
      <div><div class="label">Obra social</div><div class="valor">${legajo.obraSocial || '—'}</div></div>
      <div><div class="label">Remuneración básica</div><div class="valor">
        <input type="number" class="input-basico" step="0.01" value="${r.basico}"
               onchange="actualizarBasicoDesdeRecibo(this.value)" title="Podés modificarla y se recalcula al instante">
      </div></div>
    </div>
    <div class="recibo-grid cols-5">
      <div><div class="label">Fecha ingreso</div><div class="valor">${fechaAR(legajo.fechaIngreso)}</div></div>
      <div><div class="label">Categoría</div><div class="valor">${legajo.categoria || '—'}</div></div>
      <div><div class="label">Tarea desempeñada</div><div class="valor">${legajo.tarea || '—'}</div></div>
      <div><div class="label">Fecha último depósito</div><div class="valor">${ctx.fechaPago ? fechaAR(ctx.fechaPago) : '—'}</div></div>
      <div><div class="label">Banco</div><div class="valor">${legajo.banco || '—'}</div></div>
    </div>

    <table class="recibo-conceptos">
      <thead>
        <tr><th style="width:34%">Conceptos</th><th>Un.</th><th>Remunerativo</th><th>No remunerativo</th><th>Descuentos</th></tr>
      </thead>
      <tbody>
        ${filasBasico}
        <tr><td>Antigüedad</td><td class="num">${r.antiguedadDetalle}</td><td class="num">${money(r.antiguedadImporte)}</td><td class="num"></td><td class="num"></td></tr>
        <tr><td>Asistencia y Puntualidad</td><td class="num"></td><td class="num">${money(r.presentismoImporte)}</td><td class="num"></td><td class="num"></td></tr>
        ${r.aCuenta ? `<tr><td>A cuenta de futuros aumentos</td><td class="num"></td><td class="num">${money(r.aCuenta)}</td><td class="num"></td><td class="num"></td></tr>` : ''}
        ${filasFeriados}
        ${filasRem}
        ${filasNoRem}
        ${filasDescuentos}
        <tr class="totales">
          <td>TOTALES</td><td></td>
          <td class="num">${money(r.totalRemunerativo)}</td>
          <td class="num">${money(r.totalNoRemunerativo)}</td>
          <td class="num">${money(r.totalDescuentos)}</td>
        </tr>
      </tbody>
    </table>

    <div class="recibo-neto">NETO A COBRAR &nbsp; ${money(r.neto)}</div>
    <div class="recibo-leyenda">
      <strong>Son pesos:</strong> ${Calculos.numeroALetras(r.neto)}
    </div>

    <div class="recibo-contrib-title">Contribuciones a cargo del empleador</div>
    <table class="recibo-conceptos">
      <thead><tr><th style="width:50%">Concepto</th><th>Un.</th><th>Importe</th></tr></thead>
      <tbody>
        ${filasContrib}
        <tr class="totales"><td>TOTAL CONTRIBUCIONES</td><td></td><td class="num">${money(r.totalContribuciones)}</td></tr>
      </tbody>
    </table>

    <div class="recibo-firma">
      <div class="linea"></div>
      Firma del empleado
      <p style="margin-top:14px; font-size:10px;">Recibí el importe de esta liquidación en pago de mi remuneración correspondiente al período indicado y duplicado de la misma conforme a la ley vigente.</p>
    </div>
    <div class="recibo-pie">Lugar y fecha de pago: ${cliente.provincia || ''}, ${ctx.fechaPago ? fechaAR(ctx.fechaPago) : '—'}</div>
  </div>`;
}

async function guardarLiquidacionActual() {
  if (!liquidacionActualContexto) return;
  try {
    await DB.guardarLiquidacion(liquidacionActualContexto);
    alert('Liquidación guardada correctamente en la base de datos en la nube.');
    await renderHistorialLiquidaciones();
    await actualizarDashboard();
  } catch (err) { mostrarErrorEnPantalla(err); }
}

async function renderHistorialLiquidaciones() {
  try {
    const [todas, clientes, legajos] = await Promise.all([
      DB.getLiquidaciones(), DB.getClientes(), DB.getLegajos()
    ]);
    // Rural y Metalúrgica (módulos nuevos) tienen su propio historial en su pantalla
    const liqs = todas.filter(l => l.tipoLiquidacion !== 'rural' && !(l.resultado && l.resultado.modoUOM));
    const tbody = document.getElementById('tablaHistorialLiq');
    tbody.innerHTML = '';
    document.getElementById('msgSinHistorial').style.display = liqs.length ? 'none' : 'block';

    liqs.forEach(l => {
      const cliente = clientes.find(c => c.id === l.clienteId);
      const legajo = legajos.find(x => x.id === l.legajoId);
      tbody.innerHTML += `<tr>
        <td>${l.periodoTexto}</td>
        <td>${cliente ? cliente.razonSocial : '—'}</td>
        <td>${legajo ? legajo.nombre : '—'}</td>
        <td>${money(l.resultado.neto)}</td>
        <td>
          <button class="btn-icon" title="Ver recibo" onclick="verReciboGuardado('${l.id}')">👁️</button>
          <button class="btn-icon" title="Anular" onclick="eliminarLiquidacionGuardada('${l.id}')">🗑️</button>
        </td>
      </tr>`;
    });
  } catch (err) { mostrarErrorEnPantalla(err); }
}

async function verReciboGuardado(id) {
  try {
    const liqs = await DB.getLiquidaciones();
    const liq = liqs.find(l => l.id === id);
    if (!liq) return;
    // Los recibos metalúrgicos (módulo independiente) se muestran en su propia pantalla
    if (liq.resultado && liq.resultado.modoUOM) { await Metalurgica.verRecibo(id); return; }
    // Idem para los recibos rurales (módulo independiente)
    if (liq.tipoLiquidacion === 'rural' || (liq.resultado && liq.resultado.modoRural)) { await Rural.verRecibo(id); return; }
    const [cliente, legajo] = await Promise.all([DB.getCliente(liq.clienteId), DB.getLegajo(liq.legajoId)]);

    document.querySelectorAll('.menu-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelector('[data-view="liquidaciones"]').classList.add('active');
    document.getElementById('view-liquidaciones').classList.add('active');

    document.getElementById('reciboContainer').innerHTML = renderRecibo(cliente, legajo, liq, liq.resultado);
    document.getElementById('resultadoLiqCard').style.display = 'block';
    document.getElementById('formLiquidacionCard').style.display = 'none';
    document.getElementById('resultadoLiqCard').scrollIntoView({ behavior: 'smooth' });
  } catch (err) { mostrarErrorEnPantalla(err); }
}

async function eliminarLiquidacionGuardada(id) {
  if (confirm('¿Anular esta liquidación? Es un comprobante legal: no se borra, queda marcada como anulada en el historial.')) {
    try {
      await DB.eliminarLiquidacion(id);
      await renderHistorialLiquidaciones();
      await actualizarDashboard();
    } catch (err) { mostrarErrorEnPantalla(err); }
  }
}

/* =========================================================
   CONFIGURACIÓN
========================================================= */
function initConfiguracion() {
  document.getElementById('btnGuardarConfig').addEventListener('click', guardarConfiguracion);
  document.getElementById('btnResetConfig').addEventListener('click', () => {
    if (confirm('¿Restaurar los porcentajes por defecto?')) {
      DB.resetConfig();
      renderConfiguracion();
    }
  });
  renderConfiguracion();
}

function renderConfiguracion() {
  const config = DB.getConfig();
  document.getElementById('configAportes').innerHTML = config.aportes.map((a, i) => `
    <div>
      <label>${a.nombre} (%)</label>
      <input class="input" type="number" step="0.01" data-tipo="aportes" data-idx="${i}" value="${a.pct}">
    </div>
  `).join('');
  document.getElementById('configContribuciones').innerHTML = config.contribuciones.map((c, i) => {
    if (c.opciones && c.opciones.length) {
      return `
      <div>
        <label>${c.nombre} (%)</label>
        <select class="input" data-tipo="contribuciones" data-idx="${i}">
          ${c.opciones.map(op => `<option value="${op}" ${Number(c.pct) === op ? 'selected' : ''}>${String(op).replace('.', ',')}%</option>`).join('')}
        </select>
      </div>`;
    }
    return `
      <div>
        <label>${c.nombre} (%)</label>
        <input class="input" type="number" step="0.01" data-tipo="contribuciones" data-idx="${i}" value="${c.pct}">
      </div>`;
  }).join('');
}

function guardarConfiguracion() {
  const config = DB.getConfig();
  document.querySelectorAll('#configAportes input, #configContribuciones input, #configAportes select, #configContribuciones select').forEach(inp => {
    const tipo = inp.dataset.tipo, idx = inp.dataset.idx;
    config[tipo][idx].pct = Number(inp.value) || 0;
  });
  DB.guardarConfig(config);
  alert('Configuración guardada. Se aplicará como valor por defecto en las próximas liquidaciones.');
}