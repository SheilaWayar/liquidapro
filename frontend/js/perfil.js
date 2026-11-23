/* VERSION v1 — perfil.js (registro con datos personales + pantalla "Completá tus datos") */
/* =========================================================
   perfil.js
   - Formulario de registro de cuentas con datos personales:
     nombre completo, CUIL, fecha de nacimiento, correo y teléfono (opcional).
   - Pantalla "Completá tus datos" para las cuentas que todavía no los cargaron.
   Los datos se guardan en la tabla `perfiles` (ver admin_y_perfiles.sql).
   Solo reutiliza: Auth (supabaseClient.js) y abrirModal / cerrarModal /
   mostrarErrorLogin (app.js).
========================================================= */

const Perfil = (() => {

  const $ = (id) => document.getElementById(id);
  const soloDigitos = (s) => String(s || '').replace(/\D/g, '');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Validaciones ---------- */

  /** CUIL / CUIT: 11 dígitos con dígito verificador correcto */
  function cuilValido(valor) {
    const d = soloDigitos(valor);
    if (d.length !== 11) return false;
    const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const suma = pesos.reduce((acc, p, i) => acc + p * Number(d[i]), 0);
    const resto = suma % 11;
    const verificador = resto === 0 ? 0 : 11 - resto;
    return verificador !== 10 && verificador === Number(d[10]);
  }

  function formatearCuil(valor) {
    const d = soloDigitos(valor);
    return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : String(valor || '');
  }

  /** Devuelve un mensaje de error, o '' si la fecha (YYYY-MM-DD) es válida y la persona es mayor de edad */
  function errorFechaNacimiento(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return 'Cargá tu fecha de nacimiento.';
    const [y, m, d] = iso.split('-').map(Number);
    const f = new Date(Date.UTC(y, m - 1, d));
    if (f.getUTCFullYear() !== y || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return 'La fecha de nacimiento no es válida.';
    const hoy = new Date();
    let edad = hoy.getFullYear() - y;
    if (hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) edad--;
    if (edad < 0) return 'La fecha de nacimiento no puede ser futura.';
    if (edad < 18) return 'Tenés que ser mayor de edad para crear una cuenta.';
    if (edad > 110) return 'Revisá la fecha de nacimiento.';
    return '';
  }

  /** datos: { nombre, cuil, nacimiento, telefono } → mensaje de error o '' */
  function errorDatos(d) {
    const nombre = String(d.nombre || '').trim().replace(/\s+/g, ' ');
    if (nombre.split(' ').length < 2 || nombre.length < 5) return 'Escribí tu nombre y apellido completos.';
    if (nombre.length > 100) return 'El nombre es demasiado largo.';
    if (!cuilValido(d.cuil)) return 'El C.U.I.L. no es válido. Revisá los 11 números.';
    const errFecha = errorFechaNacimiento(d.nacimiento);
    if (errFecha) return errFecha;
    const tel = String(d.telefono || '').trim();
    if (tel && (!/^[0-9+()\s-]{6,25}$/.test(tel) || soloDigitos(tel).length < 6)) {
      return 'El teléfono no es válido (solo números, espacios, + - y paréntesis).';
    }
    return '';
  }

  function traducirError(msg) {
    const m = String(msg || '');
    if (/already registered|already been registered/i.test(m)) return 'Ese correo ya está registrado. Probá iniciar sesión.';
    if (/password/i.test(m) && /least|short|weak/i.test(m)) return 'La contraseña es muy corta o débil. Probá con una más larga.';
    if (/rate limit|too many/i.test(m)) return 'Hiciste demasiados intentos. Esperá unos minutos y probá de nuevo.';
    if (/invalid.*email|email.*invalid/i.test(m)) return 'El correo electrónico no es válido.';
    return m || 'No se pudo crear la cuenta.';
  }

  /* ---------- Registro (pantalla de login) ---------- */

  function mostrarErrorRegistro(msg) {
    const el = $('regError');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = 'var(--rojo)';
  }

  function abrirRegistro() {
    $('cardLogin').style.display = 'none';
    $('cardRegistro').style.display = '';
    mostrarErrorRegistro('');
    const email = $('loginEmail').value.trim();
    if (email && !$('regEmail').value) $('regEmail').value = email;
    $('regNombre').focus();
  }

  function volverLogin() {
    $('cardRegistro').style.display = 'none';
    $('cardLogin').style.display = '';
  }

  async function enviarRegistro(e) {
    e.preventDefault();
    const boton = $('formRegistro').querySelector('button[type="submit"]');
    const email = $('regEmail').value.trim();
    const pass = $('regPassword').value;
    const datos = {
      nombre: $('regNombre').value.trim().replace(/\s+/g, ' '),
      cuil: soloDigitos($('regCuil').value),
      nacimiento: $('regNacimiento').value,
      telefono: $('regTelefono').value.trim()
    };

    let err = errorDatos(datos);
    if (!err && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err = 'Escribí un correo electrónico válido.';
    if (!err && pass.length < 8) err = 'La contraseña debe tener al menos 8 caracteres.';
    if (!err && pass !== $('regPassword2').value) err = 'Las contraseñas no coinciden.';
    if (!err && !$('regAcepto').checked) err = 'Tenés que aceptar el uso de tus datos para crear la cuenta.';
    if (err) { mostrarErrorRegistro(err); return; }

    mostrarErrorRegistro('');
    boton.disabled = true;
    try {
      await Auth.registrarse(email, pass, {
        nombre_completo: datos.nombre,
        cuil: datos.cuil,
        fecha_nacimiento: datos.nacimiento,
        telefono: datos.telefono
      });
      $('formRegistro').reset();            // no deja la contraseña escrita en el formulario
      volverLogin();
      $('loginEmail').value = email;
      mostrarErrorLogin('Cuenta creada. Si tu correo requiere confirmación, revisá tu bandeja de entrada; después iniciá sesión.', true);
    } catch (error) {
      mostrarErrorRegistro(traducirError(error && error.message));
    } finally {
      boton.disabled = false;
    }
  }

  /* ---------- "Completá tus datos" (cuentas que no los cargaron) ---------- */

  async function guardarPerfil(datos) {
    const { data: ses } = await supabaseClient.auth.getSession();
    const uid = ses && ses.session && ses.session.user && ses.session.user.id;
    if (!uid) throw new Error('No hay una sesión iniciada.');
    const { error } = await supabaseClient.from('perfiles').upsert({
      user_id: uid,
      nombre_completo: datos.nombre,
      cuil: datos.cuil,
      fecha_nacimiento: datos.nacimiento,
      telefono: datos.telefono || null
    }, { onConflict: 'user_id' });
    if (error) throw error;
  }

  function abrirFormPerfil(p) {
    abrirModal(`
      <h3>Completá tus datos</h3>
      <p class="ayuda-texto">Para seguir usando LiquidaPro necesitamos tus datos personales. Solo los ven los administradores del sistema.</p>
      <div class="form-row"><label>Nombre y apellido completos</label>
        <input class="input" id="pfNombre" value="${esc(p.nombre_completo)}" autocomplete="name"></div>
      <div class="grid-2">
        <div><label>C.U.I.L.</label>
          <input class="input" id="pfCuil" inputmode="numeric" placeholder="20-12345678-9" value="${esc(formatearCuil(p.cuil))}"></div>
        <div><label>Fecha de nacimiento</label>
          <input class="input" type="date" id="pfNacimiento" value="${esc(p.fecha_nacimiento)}"></div>
      </div>
      <div class="form-row"><label>Teléfono (opcional)</label>
        <input class="input" type="tel" id="pfTelefono" value="${esc(p.telefono)}" autocomplete="tel"></div>
      <p class="login-error" id="pfError" style="color:var(--rojo)"></p>
      <div class="modal-actions">
        <button class="btn-secondary" onclick="cerrarModal()">Completar más tarde</button>
        <button class="btn-primary" id="btnPfGuardar" onclick="Perfil.guardarDesdeModal()">Guardar</button>
      </div>
    `);
  }

  async function guardarDesdeModal() {
    const error = $('pfError');
    const datos = {
      nombre: $('pfNombre').value.trim().replace(/\s+/g, ' '),
      cuil: soloDigitos($('pfCuil').value),
      nacimiento: $('pfNacimiento').value,
      telefono: $('pfTelefono').value.trim()
    };
    const err = errorDatos(datos);
    if (err) { error.textContent = err; return; }
    error.textContent = '';
    const boton = $('btnPfGuardar');
    boton.disabled = true;
    try {
      await guardarPerfil(datos);
      cerrarModal();
      alert('Datos guardados. ¡Gracias!');
    } catch (e) {
      error.textContent = (e && e.message) || 'No se pudieron guardar los datos.';
    } finally {
      boton.disabled = false;
    }
  }

  /** Se llama al entrar a la app: si al perfil le faltan datos obligatorios, abre "Completá tus datos" */
  async function pedirDatosSiFaltan() {
    try {
      const { data: ses } = await supabaseClient.auth.getSession();
      const uid = ses && ses.session && ses.session.user && ses.session.user.id;
      if (!uid) return;
      const { data, error } = await supabaseClient.from('perfiles')
        .select('nombre_completo,cuil,fecha_nacimiento,telefono').eq('user_id', uid).maybeSingle();
      if (error) { console.warn('Perfil: no se pudo leer el perfil', error); return; }   // p. ej. falta ejecutar el SQL
      // si mientras tanto se cerró la sesión o entró otra cuenta, no mostramos nada
      const { data: ses2 } = await supabaseClient.auth.getSession();
      const uid2 = ses2 && ses2.session && ses2.session.user && ses2.session.user.id;
      if (uid2 !== uid) return;
      if (data && data.nombre_completo && data.cuil && data.fecha_nacimiento) return;
      abrirFormPerfil(data || {});
    } catch (e) { console.warn('Perfil: error al verificar los datos', e); }
  }

  function init() {
    const form = $('formRegistro');
    if (!form) return;
    form.addEventListener('submit', enviarRegistro);
    $('btnVolverLogin').addEventListener('click', volverLogin);
  }

  document.addEventListener('DOMContentLoaded', init);

  return { abrirRegistro, volverLogin, pedirDatosSiFaltan, guardarDesdeModal,
           _cuilValido: cuilValido, _errorFechaNacimiento: errorFechaNacimiento, _errorDatos: errorDatos };
})();