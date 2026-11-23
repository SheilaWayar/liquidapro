# LiquidaPro

Aplicación web para liquidar sueldos, con liquidaciones adaptadas a rubros especializados que tienen reglas de cálculo propias.

Demo online: https://liquidapro.vercel.app

## Descripción

LiquidaPro automatiza el cálculo de la liquidación de sueldos para evitar errores manuales y ahorrar tiempo en una tarea repetitiva. Además de la liquidación general, incluye liquidaciones para rubros especializados, donde cada actividad tiene sus propias particularidades.

## Funcionalidades

- Liquidación de sueldos de empleados.
- Liquidación por rubro especializado: gastronómico, metalúrgico y rural.
- Carga de datos y porcentajes según cada caso.
- Almacenamiento de la información en una base de datos en Supabase.
- [COMPLETAR: otras funciones reales, por ejemplo recibos en PDF, historial de liquidaciones o inicio de sesión]

## Tecnologías

- HTML, CSS y JavaScript
- Supabase (base de datos)
- Vercel (deploy)
- Git y GitHub

## Estructura del proyecto

```
liquidapro/
├── frontend/
│   ├── css/
│   │   └── style.css
│   ├── img/
│   └── js/
│       ├── app.js               Lógica general de la aplicación
│       ├── calculos.js          Cálculos de las liquidaciones
│       ├── config.js            Configuración
│       ├── db.js                Acceso a la base de datos
│       ├── supabaseClient.js    Conexión con Supabase
│       ├── gastronomico.js      Liquidación del rubro gastronómico
│       ├── metalurgica.js       Liquidación del rubro metalúrgico
│       └── rural.js             Liquidación del rubro rural
├── supabase/
│   └── migrations/              Migraciones de la base de datos
├── index.html                   Página principal
└── README.md
```

## Cómo ejecutarlo en local

El proyecto no necesita instalar dependencias.

1. Clonar el repositorio:

```bash
git clone https://github.com/SheilaWayar/liquidapro.git
```

2. Abrir la carpeta en Visual Studio Code.

3. Iniciar un servidor local con la extensión Live Server (botón "Go Live" abajo a la derecha) o abrir `index.html` en el navegador.

4. La conexión con Supabase se configura en `frontend/js/config.js` y `frontend/js/supabaseClient.js`, con la URL del proyecto y la clave pública (anon key).

## Mi rol

[COMPLETAR: qué parte hice yo, por ejemplo el diseño de la interfaz, la lógica de cálculo de cada rubro, la base de datos en Supabase y el despliegue en Vercel]

## Qué aprendí

- Modelado de datos y migraciones con Supabase.
- Implementación de reglas de negocio distintas para cada rubro.
- Organización de un proyecto en varios archivos JavaScript.
- Despliegue de una aplicación web en Vercel.

## Autora

Sheila Wayar, programadora web junior. Salta, Argentina.

- GitHub: https://github.com/SheilaWayar
- Email: sheila.wayar.3@gmail.com