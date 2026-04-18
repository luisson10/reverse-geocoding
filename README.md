# geolocalizar-inegi-coordenadas

Servicio HTTP de **reverse geocoding** usando datos oficiales del INEGI. Le pasás una coordenada (latitud/longitud en WGS84, lo que te devuelve Google Maps) y te responde el **asentamiento** (colonia, fraccionamiento, barrio, etc.) y el **municipio** que contiene ese punto.

Si el punto cae en una zona rural sin colonia delimitada por el INEGI, el servicio hace **fallback automático a municipio** — no se queda mudo.

Cobertura actual: **Colima** y **Jalisco**.

---

## ¿Por qué existe esto?

La API de **Address Validation / Geocoding de Google Maps** a veces devuelve `locality` o `neighborhood` incorrectos para direcciones en México. El problema no es el `lat/lng` (ese sí lo da bien) sino los componentes administrativos (colonia y municipio), que Google arma con sus propios datasets.

Este servicio resuelve el problema **invirtiendo el flujo**: tomás el `lat/lng` de Google (que es confiable) y lo cruzás contra los polígonos oficiales del INEGI para obtener la colonia y municipio reales según la cartografía mexicana.

---

## Stack y dependencias

### Runtime

| Herramienta | Versión | Para qué |
|---|---|---|
| **Node.js** | 25.x (sirve 18+) | runtime del servidor HTTP |
| **npm** | 11.x | gestor de paquetes |
| **TypeScript** | 5.x | tipado estricto + decorators para NestJS |

### Librerías (de `package.json`)

| Paquete | Para qué |
|---|---|
| [`@nestjs/core`](https://nestjs.com/) + [`@nestjs/common`](https://nestjs.com/) | Framework de aplicación con módulos, DI y decorators. Organiza todo en clases bien definidas (controller, service, module) sin perder performance. |
| [`@nestjs/platform-fastify`](https://docs.nestjs.com/techniques/performance) | **Adapter de Fastify** usado por Nest como motor HTTP subyacente. Tenemos la velocidad cruda de Fastify + la ergonomía de Nest. |
| [`class-validator`](https://github.com/typestack/class-validator) + [`class-transformer`](https://github.com/typestack/class-transformer) | Validación declarativa del body vía decorators en los DTOs. El `ValidationPipe` global rechaza inputs inválidos con HTTP 400. |
| [`rbush`](https://github.com/mourner/rbush) | **R-tree** en memoria pura JS. Indexa los *bounding boxes* de los polígonos para que la búsqueda sea O(log n) en vez de O(n). Sin esto, cada request iteraría los ~9,000 polígonos uno por uno. |
| [`@turf/boolean-point-in-polygon`](https://turfjs.org/docs/api/booleanPointInPolygon) | Algoritmo clásico **ray casting** para determinar si un punto está dentro de un polígono. Lo usamos después del rbush para confirmar el match exacto sobre los candidatos. |
| [`@turf/helpers`](https://turfjs.org/docs/api/point) | Helpers para construir features GeoJSON (`point()`, etc.). |
| [`csv-parse`](https://csv.js.org/parse/) | Parser de CSV para leer el catálogo AGEEML de municipios. |

### Herramienta externa (solo si agregás estados nuevos)

| Herramienta | Versión | Para qué |
|---|---|---|
| **GDAL (`ogr2ogr`)** | 3.12 | **Reproyecta** los shapefiles del INEGI de Lambert Conformal Conic (México ITRF2008) a WGS84 y los convierte a GeoJSON. Es el estándar de la industria geoespacial. |

> **Opcional.** Si solo vas a correr el servicio con los estados ya incluidos (Colima + Jalisco), no necesitás GDAL — los GeoJSONs procesados ya están en el repo. Solo hace falta si vas a agregar un estado nuevo o actualizar la data del INEGI.

### Verificar que todo está instalado

```bash
node --version
npm --version
ogr2ogr --version
```

Si falta GDAL:

```bash
brew install gdal
```

---

## Cómo correrlo — 3 pasos

### 1. Instalar dependencias

```bash
npm install
```

### 2. Preprocesar los shapefiles (solo si agregás estados nuevos)

> **Si clonaste el repo y solo querés correr el servicio, saltá al paso 3.** Los GeoJSONs procesados ya están en `data/geojson/` committeados en el repo.

Este paso solo hace falta cuando **agregás un estado nuevo** o **actualizás la data del INEGI**. Requiere GDAL (`brew install gdal`) y los SHPs crudos en `data/raw/`.

```bash
npm run preprocess
```

Convierte los `.shp` de INEGI (Lambert CCL) a GeoJSON en WGS84 y copia el catálogo AGEEML. Al terminar tenés en `data/geojson/`:

| Archivo | Contenido | Polígonos |
|---|---|---|
| `06as.geojson` | asentamientos de Colima | 990 |
| `14as.geojson` | asentamientos de Jalisco | 7,969 |
| `06mun.geojson` | municipios de Colima | 10 |
| `14mun.geojson` | municipios de Jalisco | 125 |

Y en `data/catalogs/`:

| Archivo | Contenido |
|---|---|
| `municipios.csv` | Catálogo AGEEML nacional (2,478 municipios de todo México) |

Ver sección [Agregar más estados](#agregar-más-estados-o-localidades) para el flujo completo.

### 3. Compilar y levantar el servidor

```bash
npm run build    # compila TypeScript → dist/
npm start        # corre node dist/main.js
```

Durante desarrollo podés usar watch mode (recompila + reinicia al guardar):

```bash
npm run start:dev
```

Por defecto escucha en `http://localhost:3100`. Si el puerto está ocupado:

```bash
PORT=4000 npm start
```

### Configuración por variables de entorno

| Variable | Default | Para qué |
|---|---|---|
| `PORT` | `3100` | Puerto del servidor HTTP |
| `INEGI_DATA_ROOT` | `<cwd>/data` | Ruta absoluta al folder `data/` generado por `preprocess.sh`. Útil en Docker, CI, o cuando corrés desde otro directorio. |

Ejemplo apuntando a otro data root:

```bash
INEGI_DATA_ROOT=/opt/inegi/data npm start
```

Deberías ver algo así:

```
[Nest] LOG [NestFactory] Starting Nest application...
[Nest] LOG [InstanceLoader] InegiModule dependencies initialized
[Nest] LOG [RoutesResolver] ReverseGeocodeController {/}
[Nest] LOG [RouterExplorer] Mapped {/health, GET} route
[Nest] LOG [RouterExplorer] Mapped {/reverse-geocode, POST} route
[Nest] LOG [InegiLoaderService] Loaded 990 polygons from Colima
[Nest] LOG [InegiLoaderService] Loaded 7969 polygons from Jalisco
[Nest] LOG [InegiLoaderService] Loaded 2478 municipios from catalog
[Nest] LOG [InegiLoaderService] Total polygons indexed: 8959 asentamientos, 135 municipios
{"msg":"Server listening at http://0.0.0.0:3100"}
```

---

## Endpoints

### `GET /health`

Verifica que el servidor arrancó y cargó la data.

```bash
curl http://localhost:3100/health
```

**Respuesta:**

```json
{
  "status": "ok",
  "polygons": 8959,
  "munPolygons": 135,
  "municipios": 2478
}
```

| Campo | Qué es |
|---|---|
| `polygons` | Total de polígonos de asentamientos (colonias + fraccionamientos + etc.) cargados |
| `munPolygons` | Total de polígonos municipales cargados (para el fallback) |
| `municipios` | Entradas del catálogo AGEEML (nombres de municipios de todo México) |

---

### `POST /reverse-geocode`

Recibe latitud/longitud (WGS84) y devuelve el asentamiento + municipio que lo contiene.

**Request:**

```bash
curl -X POST http://localhost:3100/reverse-geocode \
  -H "Content-Type: application/json" \
  -d '{"lat":20.6767,"lng":-103.3475}'
```

**Body schema:**

| Campo | Tipo | Rango | Requerido |
|---|---|---|---|
| `lat` | number | `-90` a `90` | ✓ |
| `lng` | number | `-180` a `180` | ✓ |

Si mandás algo inválido, el `ValidationPipe` global de Nest (apoyado en `class-validator`) devuelve **400** automáticamente.

#### Response 200 — hit en asentamiento (colonia)

```json
{
  "match_level": "asentamiento",
  "cve_ent": "14",
  "nom_ent": "Jalisco",
  "nom_abr": "Jal.",
  "cve_mun": "039",
  "nom_mun": "Guadalajara",
  "cve_loc": "0001",
  "cve_asen": "0177",
  "nom_asen": "CENTRO",
  "tipo": "COLONIA",
  "cp": "44100",
  "cvegeo": "1403900010177"
}
```

#### Response 200 — fallback a municipio (rural)

```json
{
  "match_level": "municipio",
  "cve_ent": "14",
  "nom_ent": "Jalisco",
  "nom_abr": "Jal.",
  "cve_mun": "027",
  "nom_mun": "Cuautitlán de García Barragán",
  "cve_loc": null,
  "cve_asen": null,
  "nom_asen": null,
  "tipo": null,
  "cp": null,
  "cvegeo": "14027"
}
```

**Interpretación del campo `match_level`** (clave para el cliente):

| `match_level` | Qué significa | Campos con valor | Campos `null` |
|---|---|---|---|
| `"asentamiento"` | El punto cayó dentro de una colonia delimitada | todos | ninguno |
| `"municipio"` | El punto cayó en zona rural sin colonia — solo se pudo resolver a nivel municipio | `cve_ent`, `nom_ent`, `nom_abr`, `cve_mun`, `nom_mun`, `cvegeo` (5 dígitos) | `cve_loc`, `cve_asen`, `nom_asen`, `tipo`, `cp` |

> Ojo con `cvegeo`: son **13 dígitos** cuando es asentamiento (`"1403900010177"`) y **5 dígitos** cuando es municipio (`"14027"`). El cliente debe inspeccionar `match_level` antes de parsearlo.

#### Response 404 — el punto no cae en ningún polígono

```json
{
  "message": "No INEGI polygon contains point (0, 0)",
  "error": "Not Found",
  "statusCode": 404
}
```

Seguimos el formato estándar de excepciones de NestJS (`{ statusCode, message, error }`) para que cualquier cliente que ya conozca Nest lo parsee sin sorpresas.

Esto pasa cuando el punto está **fuera del territorio cubierto** (fuera de Colima/Jalisco, en el mar, fuera de México, etc.).

---

## Ejemplos de prueba

```bash
# Hit en asentamiento — Guadalajara centro
curl -X POST http://localhost:3100/reverse-geocode \
  -H "Content-Type: application/json" \
  -d '{"lat":20.6767,"lng":-103.3475}'

# Hit en asentamiento — Colima centro
curl -X POST http://localhost:3100/reverse-geocode \
  -H "Content-Type: application/json" \
  -d '{"lat":19.2433,"lng":-103.7247}'

# Fallback a municipio — zona rural de Jalisco (Cuautitlán de García Barragán)
curl -X POST http://localhost:3100/reverse-geocode \
  -H "Content-Type: application/json" \
  -d '{"lat":19.6,"lng":-104.3}'

# 404 — fuera de cobertura
curl -X POST http://localhost:3100/reverse-geocode \
  -H "Content-Type: application/json" \
  -d '{"lat":0,"lng":0}'
```

---

## Estructura del proyecto

```
geolocalizar_inegi_coordenadas/
├── package.json
├── tsconfig.json                      # TS strict, decorators, commonjs
├── nest-cli.json                      # config del compilador Nest
├── README.md
│
├── scripts/
│   └── preprocess.sh                  # ogr2ogr SHP → GeoJSON (WGS84)
│
├── src/
│   ├── main.ts                        # bootstrap Nest + FastifyAdapter + ValidationPipe
│   ├── app.module.ts                  # módulo raíz
│   └── inegi/
│       ├── inegi.module.ts            # provee loader + service, expone controller
│       ├── inegi-loader.service.ts    # OnModuleInit: carga GeoJSONs + AGEEML + rbush
│       ├── reverse-geocode.service.ts # point-in-polygon + fallback a municipio
│       ├── reverse-geocode.controller.ts  # GET /health + POST /reverse-geocode
│       ├── inegi.types.ts             # tipos internos (feature, bbox, municipio)
│       └── dto/
│           ├── reverse-geocode-request.dto.ts   # class-validator DTO
│           └── reverse-geocode-response.dto.ts  # DTO + MatchLevel enum
│
├── data/                              # toda la data del proyecto
│   ├── raw/                           # (LOCAL ONLY — gitignored)
│   │   │                              # descargas crudas del INEGI que cada dev baja manualmente
│   │   ├── 06_colima_colonias/        # SHP de asentamientos Colima
│   │   ├── 06_colima_geoestadistico/  # SHP de municipios Colima (Marco Geoestadístico)
│   │   ├── 14_jalisco_colonias/       # SHP de asentamientos Jalisco
│   │   ├── 14_jalisco_geoestadistico/ # SHP de municipios Jalisco (Marco Geoestadístico)
│   │   └── catun_municipio/           # catálogo AGEEML crudo
│   ├── geojson/                       # (COMMITTEADO) generado por preprocess.sh
│   │   ├── 06as.geojson               # asentamientos Colima
│   │   ├── 14as.geojson               # asentamientos Jalisco
│   │   ├── 06mun.geojson              # municipios Colima (fallback)
│   │   └── 14mun.geojson              # municipios Jalisco (fallback)
│   └── catalogs/                      # (COMMITTEADO) generado por preprocess.sh
│       └── municipios.csv             # AGEEML (nombres de municipios)
│
├── dist/                              # generado por `npm run build` (gitignored)
│
└── .gitignore                         # ignora data/raw/, dist/, node_modules/, .env, caches de IDE
```

> **Subdivisión de `data/`:**
> - **`data/raw/`** → `gitignored`, **solo local**. Descargas manuales del INEGI. Contenido mínimo por carpeta: `NNas.shp` + sidecars para colonias, `NNmun.shp` + sidecars para municipios. Todo lo demás (PDFs, XMLs, catálogos redundantes, capas que no usamos) se puede borrar.
> - **`data/geojson/` y `data/catalogs/`** → **committeados al repo**. Auto-generados por `npm run preprocess` (solo el dev que agrega un estado corre el preprocess; los demás solo clonan). **No editar a mano.**
>
> Esta separación permite que cualquiera clone y arranque con `npm install && npm run build && npm start` sin instalar GDAL ni bajar nada del INEGI.

---

## Arquitectura de clases

El proyecto está organizado siguiendo los principios de NestJS: **cada clase tiene una única responsabilidad** y se conecta con las demás vía **Dependency Injection** (DI). Esto hace el código fácil de testear, reemplazar y razonar.

### Tabla de clases

| Clase | Archivo | Responsabilidad | Inyecta |
|---|---|---|---|
| `AppModule` | `src/app.module.ts` | Módulo raíz de la aplicación. Importa los módulos de features. | — |
| `InegiModule` | `src/inegi/inegi.module.ts` | Agrupa todo lo relacionado con INEGI (loader, service, controller). Define qué se expone. | — |
| `InegiLoaderService` | `src/inegi/inegi-loader.service.ts` | Singleton que **carga** los GeoJSONs y el catálogo AGEEML al boot y expone los índices rbush. | — |
| `ReverseGeocodeService` | `src/inegi/reverse-geocode.service.ts` | Lógica de negocio: **resuelve** un lat/lng a asentamiento/municipio usando los índices del loader. | `InegiLoaderService` |
| `ReverseGeocodeController` | `src/inegi/reverse-geocode.controller.ts` | Capa HTTP: valida entrada, llama al service, devuelve response. No tiene lógica de negocio. | `ReverseGeocodeService`, `InegiLoaderService` (para `/health`) |
| `ReverseGeocodeRequestDto` | `src/inegi/dto/reverse-geocode-request.dto.ts` | Forma del body de entrada + reglas de validación (`@IsNumber`, `@Min`, `@Max`). | — |
| `ReverseGeocodeResponseDto` | `src/inegi/dto/reverse-geocode-response.dto.ts` | Forma del response + enum `MatchLevel`. | — |

### Diagrama de dependencias (DI graph)

```
                ┌─────────────────────┐
                │     AppModule       │
                └──────────┬──────────┘
                           │ imports
                           ▼
                ┌─────────────────────┐
                │    InegiModule      │
                └──────────┬──────────┘
                           │ provides
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐
  │ InegiLoader  │  │ ReverseGeo-  │  │ ReverseGeocode           │
  │ Service      │◄─┤ codeService  │◄─┤ Controller               │
  │ (singleton)  │  │              │  │ GET /health              │
  │ OnModuleInit │  │              │  │ POST /reverse-geocode    │
  └──────────────┘  └──────────────┘  └──────────────────────────┘
```

Las flechas indican **dirección de la inyección**: el controller depende del service, que depende del loader. El loader no depende de nadie — es la raíz del grafo.

### Separación en capas

| Capa | Archivos | Qué hace | Qué NO hace |
|---|---|---|---|
| **HTTP** (presentación) | `*.controller.ts`, `dto/*` | Recibe requests, valida, serializa responses | Lógica de negocio, I/O de archivos |
| **Dominio** (negocio) | `reverse-geocode.service.ts` | Algoritmo point-in-polygon, decisión de fallback | Conocer HTTP, leer archivos |
| **Infraestructura** (datos) | `inegi-loader.service.ts` | Leer archivos, parsear CSV, construir índices | Lógica de resolución de puntos |
| **Configuración** | `*.module.ts`, `main.ts` | Wire-up, bootstrap | Nada más |

Si en el futuro migrás el loader a PostGIS, solo tocás `inegi-loader.service.ts`. El controller y el service de negocio no se enteran.

---

## Cómo funciona por dentro

### El problema

Los shapefiles del INEGI vienen en proyección **Lambert Conformal Conic (México ITRF2008)** — una proyección cónica optimizada para minimizar distorsión sobre México. Las coordenadas están en **metros** desde un falso origen.

Google Maps (y el 99% de APIs de geocoding) usa **WGS84 / EPSG:4326** — coordenadas en **grados** de latitud/longitud.

Si intentás hacer point-in-polygon con un `lat/lng` de Google directo sobre un shapefile en Lambert, el punto cae en otro continente. Por eso **siempre** hay que reproyectar uno de los dos.

### La solución en 3 etapas

#### 1. Preprocesamiento (una sola vez — `scripts/preprocess.sh`)

`ogr2ogr` reproyecta todos los shapefiles:

```bash
ogr2ogr -f GeoJSON -t_srs EPSG:4326 salida.geojson entrada.shp
```

- `-t_srs EPSG:4326` → reproyecta a WGS84
- `-f GeoJSON` → formato de salida

Hacemos esto **al preprocesar y no en runtime** porque reproyectar 9,000 polígonos en cada request sería un suicidio de performance. Una vez reproyectados, trabajamos en WGS84 de punta a punta.

#### 2. Boot del servidor (`src/inegi/inegi-loader.service.ts`)

NestJS crea el `InegiLoaderService` como singleton y ejecuta su hook `OnModuleInit` antes de aceptar tráfico:

1. Se leen los 4 GeoJSONs (asentamientos + municipios de Colima y Jalisco).
2. Para cada polígono se calcula su **bounding box** (el rectángulo mínimo que lo contiene): `{ minX, minY, maxX, maxY }`. En `MultiPolygon` se itera cada subpolígono.
3. Se construyen **dos índices rbush (R-tree) independientes**:
   - Uno con los bboxes de asentamientos.
   - Otro con los bboxes de municipios.
4. Se parsea el CSV AGEEML en un `Map` keyed por `CVE_ENT + CVE_MUN` → `{ nom_ent, nom_mun, ... }`.

El loader expone esas estructuras como props públicas. Nest las **inyecta** en el `ReverseGeocodeService` vía constructor (DI clásico, `constructor(private readonly loader: InegiLoaderService)`). Todo queda en memoria: ~37 MB de GeoJSON + 2 índices. El boot tarda ~1-2s en una Mac moderna.

#### 3. Runtime — cada request (`src/inegi/reverse-geocode.service.ts`)

Cuando llega un `{ lat, lng }`:

```
1. Buscar en rbush de ASENTAMIENTOS
   └─ rbush.search({ minX: lng, minY: lat, maxX: lng, maxY: lat })
      devuelve candidatos cuyos bboxes contienen el punto (O(log n))
   └─ Para cada candidato: booleanPointInPolygon (ray casting)
   └─ ¿Primer match? → devolver con match_level: "asentamiento"

2. Si ningún asentamiento contiene el punto →
   Buscar en rbush de MUNICIPIOS (misma lógica)
   └─ ¿Match? → devolver con match_level: "municipio"
                y campos de asentamiento en null

3. Si tampoco → 404
```

**¿Por qué 2 pasos (rbush → turf)?** El rbush filtra por bounding box (rectángulo), que es grueso y rápido. Un bbox puede contener el punto pero el polígono real (que es irregular) puede que no. Por eso pasamos los candidatos del rbush al algoritmo **ray casting** de Turf, que sí hace la verificación geométrica exacta.

**¿Cómo se valida el input?** El `ReverseGeocodeRequestDto` usa decorators de `class-validator` (`@IsNumber`, `@Min`, `@Max`). El `ValidationPipe` global registrado en `main.ts` corre esas reglas antes de llamar al controller — si el body no cumple, devuelve 400 automáticamente. Sin schemas a mano, sin repetir tipado: la clase ES el schema.

**¿Por qué hacemos join con AGEEML si los shapefiles ya tienen `CVE_MUN`?** Porque los shapefiles traen la **clave** del municipio (`"039"`) pero no el **nombre** (`"Guadalajara"`). El catálogo AGEEML es la fuente oficial de nombres y los indexa para todos los 2,478 municipios de México. Usamos AGEEML para consistencia aunque el shapefile de municipios trae un campo `NOMGEO` — AGEEML es más limpio y centraliza el catálogo.

### Flujo completo de una request

```
Cliente
  │  POST /reverse-geocode  { "lat": 20.6767, "lng": -103.3475 }
  ▼
FastifyAdapter (Nest platform)
  │  → matchea ruta al ReverseGeocodeController.reverseGeocode()
  ▼
ValidationPipe (global, registrado en main.ts)
  │  → corre class-validator sobre el body contra ReverseGeocodeRequestDto
  │  → si falla: HTTP 400 (no llega al controller)
  ▼
ReverseGeocodeController
  │  → llama a this.service.resolve(dto.lat, dto.lng)
  ▼
ReverseGeocodeService.resolve()
  │  → usa this.loader.tree (rbush asentamientos)
  │  → busca candidatos por bbox, refina con booleanPointInPolygon
  │  → ¿match? → construye ReverseGeocodeResponseDto y retorna
  │  → ¿no? → usa this.loader.munTree (rbush municipios) — mismo flujo
  │  → ¿no? → throw new NotFoundException(...)
  ▼
NestJS exception filter
  │  → transforma NotFoundException en HTTP 404 con body JSON
  ▼
Cliente
     HTTP 200 + JSON response (o 404/400 según corresponda)
```

### Testing (cómo se debería testear cada clase)

Gracias a la DI, cada clase se puede testear de forma aislada **inyectando mocks**:

| Clase | Estrategia de testing |
|---|---|
| `InegiLoaderService` | Integration test — fija rutas de test con GeoJSONs chicos, valida que el rbush quede bien armado. |
| `ReverseGeocodeService` | Unit test — mock del `InegiLoaderService` con features sintéticas, verifica la lógica de fallback y el formato del response. |
| `ReverseGeocodeController` | Unit test — mock del `ReverseGeocodeService`, verifica que se pasen los argumentos correctos y se serialice bien. |
| End-to-end | `@nestjs/testing` + `supertest` sobre el `FastifyAdapter`, testea los endpoints contra data real. |

> Actualmente no hay tests implementados. Si querés agregar, Nest trae `@nestjs/testing` y el proyecto está listo para recibirlos.

---

## Datos de origen

Todos los datos vienen de productos públicos y gratuitos del **Instituto Nacional de Estadística y Geografía (INEGI)**.

### Producto 1: Asentamientos humanos

> *Delimitación de colonias y otros asentamientos humanos 2025*

- Fuente: <https://www.inegi.org.mx/app/mapas/?t=0>
- Archivos usados: `06as.shp`, `14as.shp` (+ sidecars `.dbf`, `.shx`, `.prj`, `.sbn`, `.sbx`)
- Proyección nativa: Lambert Conformal Conic, México ITRF2008
- Cobertura: **NO es completa**. Solo las localidades delimitadas por la autoridad municipal. Zonas rurales suelen quedar fuera → para esos casos usamos el fallback de municipios.

### Producto 2: Marco Geoestadístico (para el fallback de municipios)

- Archivos usados: `06mun.shp`, `14mun.shp` (+ sidecars)
- Misma proyección Lambert Conformal Conic.
- Cobertura: **todos los municipios** de cada entidad federativa (125 en Jalisco, 10 en Colima).

### Producto 3: Catálogo AGEEML

> *Área Geoestadística Estatal, Municipal y Localidad*

- Archivo usado: `AGEEML_202631880673_utf8.csv` (copiado como `data/catalogs/municipios.csv`)
- Contiene: 2,478 municipios de todo México con claves INEGI + nombres + población + viviendas.
- Campos clave para nuestro join: `CVE_ENT`, `CVE_MUN`, `NOM_ENT`, `NOM_ABR`, `NOM_MUN`.

---

## Avisos sobre la data del INEGI

Cosas que pueden sorprender si no conocés la data del INEGI:

- **`cp` puede venir como `"0"` o `"00000"`** — INEGI aclara explícitamente que el código postal **no fue validado con Correos de México**. Si necesitás CP confiable, no lo tomes de acá.
- **`tipo` es un string** (`"COLONIA"`, `"FRACCIONAMIENTO"`, `"BARRIO"`, `"NINGUNO"`, `"UNIDAD HABITACIONAL"`, etc.), **no un código numérico** 1..43 como dice la documentación del INEGI. El mapping numérico está en otro formato de distribución; acá recibimos el label directo.
- **`cvegeo` cambia de formato según `match_level`** (13 dígitos en asentamiento, 5 en municipio — ver tabla en [Endpoints](#post-reverse-geocode)).
- **Cobertura parcial de asentamientos**: zonas rurales y pueblos chicos suelen no tener polígono de colonia. Por eso el servicio tiene fallback a municipio — para que al menos respondas con municipio en vez de 404.

---

## Troubleshooting

### `EADDRINUSE: address already in use`

El puerto 3100 está ocupado. Usá otro:

```bash
PORT=4000 npm start
```

O matá el proceso que lo tiene:

```bash
lsof -ti:3100 | xargs kill -9
```

### `ogr2ogr: command not found`

GDAL no está instalado. Instalalo:

```bash
brew install gdal
```

### `No INEGI polygon contains point` para una coordenada que debería tener colonia

1. Verificá que la coordenada esté en **WGS84** (lat/lng de Google Maps, no de otro sistema).
2. Verificá que caiga en **Colima o Jalisco** — otros estados no están cargados todavía.
3. Si está en una zona rural sin colonia, **debería** devolver municipio (no 404). Si devuelve 404, contá el caso para debuggearlo.

### El servidor tarda en arrancar

Es normal. Se cargan ~37 MB de GeoJSON y se construyen dos índices rbush. Toma ~1-2 segundos en una Mac moderna. Una vez arriba, las requests son casi instantáneas (~ms).

### Los GeoJSONs pesan mucho para Git

El `.gitignore` del proyecto ya excluye automáticamente:

- `data/raw/` — descargas manuales del INEGI (cada dev las baja aparte)
- `data/geojson/` y `data/catalogs/` — regenerables con `npm run preprocess`
- `dist/`, `node_modules/`, `.env`, `.DS_Store`

Cualquier dev nuevo solo corre `npm install` + baja los SHPs del INEGI en `data/raw/` + `npm run preprocess`, y ya tiene todo.

---

## Agregar más estados o localidades

### Estrategia de data en este repo

Solo versionamos los archivos **procesados** (`data/geojson/` + `data/catalogs/`). Los SHPs crudos del INEGI viven en `data/raw/`, que **está en `.gitignore`** — cada dev los baja localmente, corre `npm run preprocess`, y solo los GeoJSONs generados terminan en el commit.

**¿Por qué?** Los SHPs crudos son grandes y cambian poco. Los GeoJSONs procesados son chicos, reproducibles, y permiten que cualquiera clone el repo y arranque con `npm install && npm run build && npm start` — sin GDAL, sin bajar nada del INEGI.

### Flujo para agregar un estado nuevo (ejemplo CDMX = `09`)

#### 1. Bajá los shapefiles del INEGI (local)

- *Delimitación de colonias y otros asentamientos humanos 2025* → descargar carpeta del estado.
- *Marco Geoestadístico* → descargar carpeta del estado para tener `09mun.shp`.

#### 2. Colocalos bajo `data/raw/` (local, no se committea)

```
data/raw/09_cdmx_colonias/conjunto_de_datos/09as.shp (+ .dbf .shx .prj)
data/raw/09_cdmx_geoestadistico/conjunto_de_datos/09mun.shp (+ sidecars)
```

Podés borrar todo lo demás (PDFs, XMLs, otras capas como `loc`, `ageb`, `mza`). Nos quedamos solo con `NNas` + `NNmun` + sus sidecars (`.dbf`, `.shx`, `.prj`, `.cpg`).

#### 3. Actualizá el código

- **`scripts/preprocess.sh`** → agregar variables `CDMX_SHP`, `CDMX_MUN_SHP`, bloques de `ogr2ogr`, y `echo` de conteos.
- **`src/inegi/inegi-loader.service.ts`** → agregar los archivos a los arreglos `asSources` y `munSources` dentro de `onModuleInit`.

#### 4. Corré el preproceso local (requiere GDAL)

```bash
npm run preprocess
```

Esto genera `data/geojson/09as.geojson` y `data/geojson/09mun.geojson`.

#### 5. Verificá que arranca

```bash
npm run build
npm start
curl -X POST http://localhost:3100/reverse-geocode \
  -H "Content-Type: application/json" \
  -d '{"lat": ..., "lng": ...}'   # coord del estado nuevo
```

#### 6. Committeá SOLO los archivos procesados + los cambios de código

```bash
git add scripts/preprocess.sh \
        src/inegi/inegi-loader.service.ts \
        data/geojson/09as.geojson \
        data/geojson/09mun.geojson

git commit -m "feat(data): agregar cobertura de CDMX"
git push origin main
```

**Clave:** `data/raw/` NO se committea (está gitignored). Esto mantiene el repo chico y evita redistribuir los SHPs crudos del INEGI.

> No hay que tocar el service ni el controller más allá de los arreglos de sources. La lógica de resolución ya es agnóstica al estado.

---

## Deploy a Railway

Esta branch (`railway-deployment`) está configurada para desplegar en [Railway](https://railway.app) usando **Nixpacks** (el builder nativo de Railway para Node.js).

### Archivos de configuración

| Archivo | Para qué |
|---|---|
| `railway.json` | Define healthcheck (`/health`), start command (`npm start`) y política de restart |
| `nixpacks.toml` | Pin de Node.js 22 para builds reproducibles. El resto (install + build) lo detecta Nixpacks desde `package.json` |
| `package.json → "engines"` | Mínimo `node >= 20` |

### Por qué Railway no necesita GDAL

Como `data/geojson/` y `data/catalogs/` están committeados al repo (versión lean, solo procesados), Railway solo corre:

```
npm ci → npm run build → npm start
```

**No instala GDAL, no reproyecta shapefiles, no corre preprocess.** Build rápido (~45s) y reproducible.

### Pasos para hacer el deploy

#### 1. Empujar la branch al repo de GitHub

```bash
git push -u github railway-deployment
```

> Asumimos que tenés un remote `github` apuntando a `https://github.com/luisson10/reverse-geocoding.git`.

#### 2. En el dashboard de Railway

1. **New Project → Deploy from GitHub repo** → seleccionás `luisson10/reverse-geocoding`.
2. En **Settings → Source**:
   - **Branch:** `railway-deployment`
   - **Root Directory:** `/` (default)
3. Railway detecta Node via Nixpacks y arranca el primer deploy automáticamente.

#### 3. Variables de entorno

| Variable | Default | Cuándo setearla |
|---|---|---|
| `PORT` | Railway la inyecta sola | **No la toques.** Railway bindea el puerto interno automáticamente. |
| `INEGI_DATA_ROOT` | `<cwd>/data` | Solo si movés la data a un volumen persistente de Railway. |

#### 4. Verificar el deploy

Cuando el build termine (~1-2 minutos el primer deploy, ~30s los siguientes), Railway te da una URL pública tipo `https://<tu-proyecto>.up.railway.app`. Probá:

```bash
# Healthcheck
curl https://<tu-proyecto>.up.railway.app/health
# {"status":"ok","polygons":8959,"munPolygons":135,"municipios":2478}

# Reverse geocode
curl -X POST https://<tu-proyecto>.up.railway.app/reverse-geocode \
  -H "Content-Type: application/json" \
  -d '{"lat":20.6767,"lng":-103.3475}'
```

#### 5. Logs y debugging

- **Logs en vivo:** Railway dashboard → tu servicio → **Deployments → View Logs**.
- **Build logs:** sección **Build** del mismo deployment.
- **Métricas:** pestaña **Metrics** (CPU, RAM, red).

### Troubleshooting Railway

**Build falla con "Cannot find module ..."**
Asegurate que `package-lock.json` esté committeado. Railway corre `npm ci`, que lo requiere.

**Healthcheck falla con timeout**
El boot carga ~37 MB de GeoJSON — toma 1-2s. Si tenés container chico, aumentá `healthcheckTimeout` en `railway.json` de 120 a 180.

**Deploy funciona pero el servicio devuelve 404 en todos los paths**
Verificá que estés pegando a la URL que Railway te dio en el dashboard (no `localhost`).

**Queremos regenerar GeoJSONs en cada deploy**
Agregá `gdal` al `nixpacks.toml`:
```toml
[phases.setup]
nixPkgs = ["nodejs_22", "gdal"]

[phases.build]
cmds = ["npm run preprocess", "npm run build"]
```
(Y committeá también `data/raw/` sacándolo del `.gitignore` en esta branch.)

---

## Próximos pasos

- [x] Fallback a municipio cuando el punto no cae en ningún asentamiento (implementado con `NNmun.shp` del Marco Geoestadístico, expuesto vía `match_level`).
- [ ] Cobertura nacional (32 estados).
- [ ] Opción para devolver **todos** los polígonos que contienen un punto (útil cuando un condominio está dentro de una colonia, o para debugging).
- [ ] Normalizar `cp: "0"` o `cp: "00000"` a `null` opcionalmente, con un flag en el request.
- [ ] Endpoint `/batch` para resolver múltiples coordenadas en una request.
- [ ] Migrar a PostGIS cuando la cobertura crezca a todo México (~80k polígonos ya no sería óptimo en memoria).

---

## Licencia de la data

Los datos usados son propiedad del **INEGI** bajo los [Términos de libre uso de la información del INEGI](https://www.inegi.org.mx/inegi/terminos.html), que permiten uso y redistribución citando la fuente. Este repositorio:

- **NO redistribuye** los SHPs crudos del INEGI (`data/raw/` está gitignored).
- **SÍ incluye** los GeoJSONs derivados (`data/geojson/`) y el catálogo AGEEML (`data/catalogs/`) — ambos son transformaciones/subconjuntos de la data original y están cubiertos por los términos del INEGI.

La fuente oficial es <https://www.inegi.org.mx/app/mapas/?t=0>.
