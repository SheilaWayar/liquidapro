/* =========================================================
   supabaseClient.js
   Inicializa el cliente de Supabase (cargado por CDN en index.html)
   y expone helpers de login/logout/sesión para el resto de la app.
========================================================= */

const supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

const Auth = {
  async iniciarSesion(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.user;
  },

  async registrarse(email, password) {
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) throw error;
    return data.user;
  },

  async cerrarSesion() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
  },

  async obtenerSesion() {
    const { data } = await supabaseClient.auth.getSession();
    return data.session;
  },

  onCambioSesion(callback) {
    supabaseClient.auth.onAuthStateChange((_event, session) => callback(session));
  }
};
