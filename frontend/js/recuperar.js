(function () {
  // Si venimos del link del mail, avisamos a app.js ANTES de que arme la sesión,
  // para que no nos lleve directo al panel y podamos pedir la nueva contraseña.
  const volviendoDeMail = location.hash.includes('type=recovery');
  if (volviendoDeMail) window.LP_RECUPERANDO = true;

  // supabaseClient se declara con const en supabaseClient.js (no cuelga de window)
  const sb = (typeof supabaseClient !== 'undefined') ? supabaseClient : null;
  if (!sb || !sb.auth) { console.error('recuperar.js: no encuentro supabaseClient'); return; }

  const $ = id => document.getElementById(id);
  const cards = ['cardLogin', 'cardRegistro', 'cardRecuperar', 'cardNuevaPass'];
  function mostrar(id) {
    cards.forEach(c => { const el = $(c); if (el) el.style.display = (c === id ? '' : 'none'); });
    $('pantallaLogin').style.display = 'flex';
    $('appShell').style.display = 'none';
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('btnOlvide').addEventListener('click', () => {
      $('recEmail').value = $('loginEmail').value || '';
      $('recMsg').textContent = '';
      mostrar('cardRecuperar');
    });
    $('btnRecVolver').addEventListener('click', () => mostrar('cardLogin'));

    $('btnEnviarRec').addEventListener('click', async () => {
      const email = $('recEmail').value.trim();
      const msg = $('recMsg');
      msg.style.color = '';
      if (!email) { msg.textContent = 'Ingresá tu correo.'; return; }
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + location.pathname
      });
      if (error) {
        msg.textContent = /rate limit/i.test(error.message)
          ? 'Se enviaron demasiados correos. Esperá un rato y probá de nuevo.'
          : error.message;
        return;
      }
      msg.style.color = '#1f6b45';
      msg.textContent = 'Listo. Revisá tu correo (y la carpeta de spam).';
    });

    $('btnGuardarNuevaPass').addEventListener('click', async () => {
      const p1 = $('newPass1').value, p2 = $('newPass2').value, msg = $('newPassMsg');
      msg.style.color = '';
      if (p1.length < 8) { msg.textContent = 'Mínimo 8 caracteres.'; return; }
      if (p1 !== p2) { msg.textContent = 'Las contraseñas no coinciden.'; return; }
      const { error } = await sb.auth.updateUser({ password: p1 });
      if (error) { msg.textContent = error.message; return; }
      await sb.auth.signOut();
      history.replaceState(null, '', location.pathname);
      alert('Contraseña actualizada. Ya podés iniciar sesión.');
      location.reload();
    });

    if (volviendoDeMail) mostrar('cardNuevaPass');
  });

  // Por si el evento llega después de cargar la página
  sb.auth.onAuthStateChange((evento) => {
    if (evento === 'PASSWORD_RECOVERY') {
      window.LP_RECUPERANDO = true;
      setTimeout(() => mostrar('cardNuevaPass'), 100);
    }
  });
})();