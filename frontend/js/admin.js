/* VERSION v2 — admin.js (panel de administración: cuentas, baja y reactivación) */
/* =========================================================
   admin.js
   MÓDULO INDEPENDIENTE del panel de administración.
   - Lista las cuentas registradas (datos del perfil, alta, último ingreso, estado).
   - Permite DAR DE BAJA (suspender) y REACTIVAR cuentas.
   - Si la cuenta que entró es administradora, la app muestra SOLO este panel
     (sin Clientes, Legajos, Liquidaciones ni contadores).

   La seguridad NO depende de este archivo: las funciones de la base
   (admin_listar_cuentas, admin_suspender_cuenta, admin_reactivar_cuenta)
   se niegan si quien llama no es administrador. Ver admin_baja_usuarios.sql.

   Si querés que el administrador pueda ver también el resto de la app
   (clientes, legajos, etc.), poné MODO_ADMIN_EXCLUSIVO en false.
========================================================= */

const Admin = (() => {

  const MODO_ADMIN_EXCLUSIVO = true;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let usuarios = [];
  let ticket = 0;        // para descartar respuestas de una sesión anterior
  let objetivo = null;   // cuenta a la que se le está por dar de baja

  const fmtCuil = (v) => {
    const d = String(v || '').replace(/\D/g, '');
    return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : String(v || '');
  };
  const fmtFecha = (iso) => {
    if (!iso) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  };
  const fmtFechaHora = (iso) => {
    if (!iso) return '';
    const f = new Date(iso);
    return isNaN(f) ? '' : f.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const perfilCompleto = (u) => !!(u.nombre_completo && u.cuil && u.fecha_nacimiento);
  const celda = (v) => (v ? esc(v) : '<span style="color:#888">—</span>');
  const mensajeError = (err) => String((err && err.message) || 'error desconocido');

  function inyectarEstilos() {
    if ($('adminEstilos')) return;
    const st = document.createElement('style');
    st.id = 'adminEstilos';
    st.textContent = `
      body.modo-admin .menu-item:not(#menuAdmin) { display: none !important; }
      .adm-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; white-space: nowrap; }
      .adm-ok { background: #e3f2e9; color: #1f6b45; }
      .adm-susp { background: #fde8e8; color: #b3261e; }
      .adm-rol { background: #e8eefc; color: #2a4fa3; }
    `;
    document.head.appendChild(st);
  }

  /* ---------- Lista ---------- */

  function render() {
    const q = ($('adminBuscar').value || '').trim().toLowerCase();
    const buscaNumeros = /^[\d\s-]+$/.test(q);
    const qDigitos = q.replace(/\D/g, '');
    const lista = usuarios.filter(u => !q ||
      [u.nombre_completo, u.email, u.telefono].some(v => String(v || '').toLowerCase().includes(q)) ||
      (buscaNumeros && qDigitos && String(u.cuil || '').includes(qDigitos)));

    const incompletos = usuarios.filter(u => !perfilCompleto(u)).length;
    const suspendidas = usuarios.filter(u => u.suspendido).length;
    const resumen = $('adminResumen');
    resumen.style.color = '';
    resumen.textContent = `${usuarios.length} cuentas registradas · ${suspendidas} dadas de baja · ${incompletos} con perfil incompleto` +
      (q ? ` · mostrando ${lista.length}` : '');

    $('adminTabla').innerHTML = lista.map(u => {
      const estado = u.suspendido
        ? `<span class="adm-badge adm-susp">Dada de baja</span>` +
          (u.motivo ? `<div class="ayuda-texto" style="margin:4px 0 0">${esc(u.motivo)}</div>` : '') +
          (u.suspendido_el ? `<div class="ayuda-texto" style="margin:2px 0 0">${esc(fmtFechaHora(u.suspendido_el))}</div>` : '')
        : '<span class="adm-badge adm-ok">Activa</span>';

      let acciones;
      if (u.es_administrador) acciones = '<span class="adm-badge adm-rol">Administrador</span>';
      else if (u.suspendido) acciones = `<button class="btn-secondary btn-sm" data-accion="reactivar" data-id="${esc(u.user_id)}">Reactivar</button>`;
      else acciones = `<button class="btn-secondary btn-sm" style="color:var(--rojo)" data-accion="suspender" data-id="${esc(u.user_id)}">Dar de baja</button>`;

      return `<tr>
        <td><strong>${u.nombre_completo ? esc(u.nombre_completo) : '<span style="color:var(--rojo)">Perfil incompleto</span>'}</strong></td>
        <td>${celda(fmtCuil(u.cuil))}</td>
        <td>${celda(fmtFecha(u.fecha_nacimiento))}</td>
        <td>${celda(u.email)}</td>
        <td>${celda(u.telefono)}</td>
        <td>${celda(fmtFechaHora(u.creado))}</td>
        <td>${celda(fmtFechaHora(u.ultimo_ingreso))}</td>
        <td>${u.email_confirmado ? 'Sí' : 'No'}</td>
        <td>${estado}</td>
        <td>${acciones}</td>
      </tr>`;
    }).join('');
    $('adminVacio').style.display = lista.length ? 'none' : 'block';
  }

  async function cargar() {
    const miTicket = ticket;
    const resumen = $('adminResumen');
    resumen.style.color = '';
    resumen.textContent = 'Cargando...';
    try {
      const { data, error } = await supabaseClient.rpc('admin_listar_cuentas');
      if (miTicket !== ticket) return;               // se cerró la sesión mientras cargaba
      if (error) throw error;
      usuarios = data || [];
      render();
    } catch (err) {
      if (miTicket !== ticket) return;
      console.error(err);
      usuarios = [];
      $('adminTabla').innerHTML = '';
      $('adminVacio').style.display = 'none';
      resumen.style.color = 'var(--rojo)';
      const m = mensajeError(err);
      resumen.textContent = /No autorizado/i.test(m)
        ? 'Tu cuenta no tiene permisos de administrador.'
        : /could not find the function|does not exist/i.test(m)
          ? 'Falta ejecutar el archivo admin_baja_usuarios.sql en Supabase (SQL Editor).'
          : 'No se pudo cargar la lista: ' + m;
    }
  }

  /* ---------- Dar de baja / reactivar ---------- */

  function pedirMotivo(u) {
    objetivo = u.user_id;
    abrirModal(`
      <h3>Dar de baja la cuenta</h3>
      <p class="ayuda-texto"><strong>${esc(u.nombre_completo || 'Sin nombre')}</strong> (${esc(u.email)}) no va a poder iniciar sesión.
        No se borra ningún dato y podés reactivarla cuando quieras.</p>
      <div class="form-row"><label>Motivo (opcional, queda registrado)</label>
        <textarea class="input" id="admMotivo" rows="3" maxlength="300" placeholder="Ej: incumplimiento de los términos de uso"></textarea></div>
      <p class="login-error" id="admModalError" style="color:var(--rojo)"></p>
      <div class="modal-actions">
        <button class="btn-secondary" onclick="cerrarModal()">Cancelar</button>
        <button class="btn-primary" id="btnAdmConfirmar" onclick="Admin.confirmarBaja()">Dar de baja</button>
      </div>
    `);
  }

  async function confirmarBaja() {
    if (!objetivo) return;
    const boton = $('btnAdmConfirmar');
    boton.disabled = true;
    try {
      const motivo = ($('admMotivo').value || '').trim();
      const { error } = await supabaseClient.rpc('admin_suspender_cuenta', { p_user_id: objetivo, p_motivo: motivo || null });
      if (error) throw error;
      objetivo = null;
      cerrarModal();
      await cargar();
    } catch (err) {
      $('admModalError').textContent = mensajeError(err);
      boton.disabled = false;
    }
  }

  async function reactivar(u) {
    if (!confirm(`¿Reactivar la cuenta de ${u.nombre_completo || u.email}? Va a poder volver a iniciar sesión.`)) return;
    try {
      const { error } = await supabaseClient.rpc('admin_reactivar_cuenta', { p_user_id: u.user_id });
      if (error) throw error;
      await cargar();
    } catch (err) {
      alert('No se pudo reactivar la cuenta: ' + mensajeError(err));
    }
  }

  /* ---------- Rol de administrador ---------- */

  /** Muestra el ítem "Admin" (y, en modo exclusivo, oculta todo lo demás) solo si la cuenta es administradora */
  async function mostrarSiEsAdmin() {
    const miTicket = ++ticket;
    const menu = $('menuAdmin');
    if (!menu) return;
    inyectarEstilos();
    menu.style.display = 'none';
    document.body.classList.remove('modo-admin');
    try {
      const { data, error } = await supabaseClient.rpc('es_admin');
      if (miTicket !== ticket) return;
      if (error) throw error;
      if (data === true) {
        menu.style.display = '';
        if (MODO_ADMIN_EXCLUSIVO) {
          document.body.classList.add('modo-admin');
          menu.click();            // abre el panel Admin directamente
        }
      }
    } catch (err) {
      console.warn('Admin: no se pudo verificar el rol de administrador', err);
      menu.style.display = 'none';
    }
  }

  /** Al cerrar sesión: oculta el menú, borra de la pantalla los datos y saca la vista Admin si estaba abierta */
  function ocultar() {
    ticket++;
    usuarios = [];
    objetivo = null;
    document.body.classList.remove('modo-admin');
    const menu = $('menuAdmin');
    if (menu) { menu.style.display = 'none'; menu.classList.remove('active'); }
    if ($('adminTabla')) $('adminTabla').innerHTML = '';
    if ($('adminResumen')) $('adminResumen').textContent = '';
    if ($('adminBuscar')) $('adminBuscar').value = '';
    const vista = $('view-admin');
    if (vista && vista.classList.contains('active')) {
      vista.classList.remove('active');
      const dash = $('view-dashboard');
      if (dash) dash.classList.add('active');
      const menuDash = document.querySelector('.menu-item[data-view="dashboard"]');
      if (menuDash) menuDash.classList.add('active');
    }
  }

  function init() {
    const menu = $('menuAdmin');
    if (!menu) return;
    inyectarEstilos();
    menu.addEventListener('click', cargar);
    $('btnAdminActualizar').addEventListener('click', cargar);
    $('adminBuscar').addEventListener('input', render);
    $('adminTabla').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-accion]');
      if (!b) return;
      const u = usuarios.find(x => x.user_id === b.dataset.id);
      if (!u) return;
      if (b.dataset.accion === 'suspender') pedirMotivo(u); else reactivar(u);
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return { mostrarSiEsAdmin, ocultar, cargar, confirmarBaja };
})();