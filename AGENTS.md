# AGENTS.md

Guía de estándares y convenciones para agentes AI (y devs humanos) que trabajen en este proyecto. **Lee este archivo antes de escribir código.**

Para entender qué hace el proyecto, leé [`README.md`](./README.md). Este archivo es para **cómo** escribimos código acá.

---

## Resumen del proyecto

Servicio HTTP de reverse geocoding sobre datos oficiales del INEGI. Input: `lat/lng` en WGS84. Output: asentamiento (colonia) + municipio, con fallback automático a municipio cuando el punto cae en zona rural sin colonia delimitada.

**Stack:** NestJS + TypeScript + Fastify adapter. Spatial index en memoria (rbush + turf). Datos cargados una vez al boot desde GeoJSONs preprocesados.

---

## Comandos

```bash
npm install                    # instalar deps
npm run preprocess             # SHP → GeoJSON (una vez, o cuando cambie data cruda)
npm run build                  # compila TS → dist/
npm start                      # corre dist/main.js
npm run start:dev              # watch mode para desarrollo
```

**No corras `npm run build` como verificación refleja después de cada cambio.** Solo corré build cuando vayas a levantar el server o al final de una tanda de cambios.

---

## Estructura canónica

```
src/
├── main.ts                              # bootstrap, adapter, ValidationPipe global
├── app.module.ts                        # módulo raíz
└── <feature>/
    ├── <feature>.module.ts              # wiring (providers + controllers + exports)
    ├── <feature>.types.ts               # tipos internos compartidos
    ├── <feature>-loader.service.ts      # infra: lee archivos/DB al boot (si aplica)
    ├── <feature>.service.ts             # lógica de dominio
    ├── <feature>.controller.ts          # HTTP — sin lógica de negocio
    └── dto/
        ├── <feature>-request.dto.ts     # input con class-validator
        └── <feature>-response.dto.ts    # output + enums asociados
```

Un archivo por clase. Nombres kebab-case para archivos, PascalCase para clases.

---

## Estándares de código

### TypeScript

- **`strict: true`** siempre. `strictNullChecks`, `noImplicitAny`, `strictBindCallApply` activos.
- **Prohibido `any`.** Si no sabés el tipo, usá `unknown` y reducilo con guards.
- Casts narrow solo cuando sea genuinamente necesario (por ejemplo, asignar a un `readonly` dentro de `onModuleInit` vía `(this as { field: T }).field = ...`).
- Imports relativos (no path aliases por ahora) — mantenemos el tsconfig simple.
- `target: ES2022`, `module: commonjs` (requerido por Nest). No agregues `"type": "module"` al `package.json` — rompe el output.

### NestJS

- **Lifecycle correcto para carga de datos:** `OnModuleInit`, NO `OnApplicationBootstrap`. Este último corre después de `listen()` y expondría tráfico a un servicio sin inicializar.
- **DI por constructor:** `constructor(private readonly dep: DepService) {}`. No uses `@Inject` a menos que haya una razón concreta (tokens, providers custom).
- **Errores HTTP:** usá las excepciones built-in de Nest (`NotFoundException`, `BadRequestException`, etc.) con mensaje string. **No pases objetos** como `new NotFoundException({ error, message })` — Nest los anida bajo `message` y rompe el shape estándar.
- **Validación:** DTOs con `class-validator`. Registrá `ValidationPipe` global en `main.ts` con:
  ```ts
  new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })
  ```
  El trío es innegociable: `transform` coerciona, `whitelist` descarta extras, `forbidNonWhitelisted` rechaza payloads con campos desconocidos.
- **`@HttpCode()` solo cuando querés cambiar el default.** Nest devuelve 201 en POST y 200 en GET; si necesitás override, dejá un comentario una línea arriba explicando por qué.

### Naming

| Qué | Convención | Ejemplo |
|---|---|---|
| Archivos | kebab-case | `inegi-loader.service.ts` |
| Clases | PascalCase | `InegiLoaderService` |
| Interfaces / types | PascalCase | `InegiFeature`, `Municipio` |
| Enums | PascalCase con valores en snake_case si mapean a API | `MatchLevel.Asentamiento = 'asentamiento'` |
| Métodos / variables | camelCase | `findContaining`, `dataRoot` |
| Campos de API (request/response JSON) | snake_case | `match_level`, `cve_ent`, `nom_mun` |
| Decorators | `@PascalCase` (de Nest) | `@Injectable()`, `@Controller()` |
| Constantes | UPPER_SNAKE_CASE solo si son verdaderamente constantes globales | `DEFAULT_PORT` |

> **Ojo con el API contract:** los campos del JSON son `snake_case` porque reflejan directamente los atributos del INEGI (`CVE_ENT`, `NOM_MUN`, etc.) convertidos a minúscula por ogr2ogr. **No cambiés esto a camelCase** — rompería el join mental con los datos oficiales.

### Comentarios

Política: **suficientes, no ruido.** Apuntamos a un codebase legible sin narrar cada línea.

**Sí escribí:**

- **JSDoc de 2-4 líneas** en cada clase exportada (propósito + comportamiento importante).
- **JSDoc de 1-3 líneas** en cada método público (qué hace + cualquier detalle no obvio).
- **Comentarios inline** solo cuando el **porqué** no es obvio del código: bugs conocidos, trade-offs, invariantes sutiles, workarounds.
- **JSDoc en campos de DTOs de respuesta** (son API pública).

**NO escribas:**

- Comentarios que reiteran el nombre del método (`// gets the user` sobre `getUser()`).
- Comentarios multi-línea explicando lo que el código ya dice claramente.
- `// TODO: ...` sin un issue de seguimiento — o lo hacés o lo sacás.
- Banners decorativos (`// ==================`).
- Timestamps, autores, historial — para eso está git.

### Archivos y funciones

- Un archivo, una clase. No mezcles helpers sueltos con una clase principal — movelos a su propio archivo si crecen.
- Funciones cortas. Si un método pasa las ~30 líneas, mirá si hay un helper privado oculto adentro.
- **Extraé helpers** cuando veas duplicación estructural (dos loops idénticos salvo por sus inputs → un método genérico). Ejemplo real del proyecto: `findContaining(tree, features, point)` unificó la búsqueda en asentamientos y municipios.

---

## Patrones arquitectónicos

### Separación de capas (no negociable)

| Capa | Qué hace | Qué NO hace |
|---|---|---|
| **HTTP** (`*.controller.ts`, `dto/`) | Validar input, llamar al service, serializar response | Lógica de negocio, I/O de archivos, acceso directo a datos |
| **Dominio** (`*.service.ts`) | Algoritmos, decisiones, composición de datos | Conocer HTTP, leer archivos, parsear CSVs |
| **Infraestructura** (`*-loader.service.ts`, adapters) | Leer archivos/DB, parsear formatos, construir índices | Lógica de resolución o validación de dominio |
| **Configuración** (`*.module.ts`, `main.ts`) | Wire-up DI, bootstrap, pipes globales | Nada más |

Si estás por meter un `readFile` en un controller, parate y mové eso al loader. Si estás por meter un `booleanPointInPolygon` en un loader, parate y mové eso al service.

### Dependency Injection

- Siempre por constructor, con `private readonly`.
- Los services singleton (`@Injectable()`) expresan infra compartida o lógica stateful.
- El loader tiene estado cargado — los services que lo consumen lo reciben por DI, no lo re-cargan.

### Campos públicos expuestos

Cuando un service necesita exponer data cargada (ej: el loader con sus rbush trees):

- Marcá los campos como `readonly` para que el consumidor no pueda mutarlos.
- Inicialízalos en `onModuleInit` vía narrow cast:
  ```ts
  public readonly features!: InegiFeature[];
  // ...
  async onModuleInit() {
    (this as { features: InegiFeature[] }).features = [...];
  }
  ```
- Si el campo es un `Map` o `Set`, el cliente igual puede mutarlo. Si te importa bloquear eso, exponé un método `get(key)` o devolvé una copia.

### Error handling en boot

- Cualquier I/O en `onModuleInit` debe estar envuelto con mensaje contextual:
  ```ts
  try {
    const raw = await fs.readFile(path, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed loading ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  ```
- `bootstrap()` en `main.ts` siempre con `.catch(err => { console.error(err); process.exit(1); })`. Sin esto, una falla de boot queda como unhandled rejection y el proceso puede quedar zombie.

### Configuración via env vars

- **Nunca** hardcodees paths a recursos externos con `__dirname` u otras rutas relativas a archivos TS compilados.
- Usá variables de entorno con defaults sensatos:
  ```ts
  private readonly dataRoot = process.env.INEGI_DATA_ROOT ?? path.resolve(process.cwd(), 'data');
  ```
- Documentá cada env var en el README (tabla: variable | default | para qué).

### Logging

- Usá `Logger` de `@nestjs/common`, no `console.log` en código de producción.
- Instanciá uno por clase: `private readonly logger = new Logger(MiClase.name);`.
- **Warn-once para data drift:** si detectás un caso anómalo recurrente (ej: clave faltante en catálogo), logueá `warn` la primera vez por valor y dedupá con un `Set<string>` para no spamear:
  ```ts
  private warnedKeys = new Set<string>();
  private warnOnce(key: string) {
    if (this.warnedKeys.has(key)) return;
    this.warnedKeys.add(key);
    this.logger.warn(`Missing catalog entry for ${key}`);
  }
  ```

### DTOs como contrato inmutable

- Request DTOs: definí clases con decorators de `class-validator`, nunca interfaces.
- Response DTOs: clases con `readonly` fields + constructor:
  ```ts
  export class MyResponseDto {
    readonly field!: string;
    constructor(init: MyResponseDto) { Object.assign(this, init); }
  }
  ```
- Construí responses con `new MyResponseDto({...})`, no con object literals sueltos. Esto garantiza que si agregás un campo a la clase, TS te obliga a inicializarlo en cada lugar.

---

## Dominio: convenciones de data del INEGI

Conocé estos quirks para no escribir bugs:

- **Proyección:** los SHPs vienen en Lambert CCL (México ITRF2008). **Reproyectá a WGS84 al preprocesar**, nunca en runtime.
- **Field names:** `ogr2ogr` convierte a lowercase los atributos del `.dbf` al generar GeoJSON. Accedé a `properties.cve_ent` (no `CVE_ENT`).
- **`cp`** puede venir `"0"` o `"00000"` — INEGI no lo valida con Correos. No asumas que es confiable.
- **`tipo`** viene como string (`"COLONIA"`, `"FRACCIONAMIENTO"`, etc.), no como código numérico 1..43 aunque la doc lo sugiera.
- **`cvegeo`** cambia de formato: 13 dígitos para asentamiento (`"1403900010177"`), 5 para municipio (`"14027"`). Siempre inspeccioná `match_level` antes de parsearlo.
- **Nombres de municipios:** vienen del catálogo AGEEML (`municipios.csv`), NO del campo `NOMGEO` del shapefile de municipios. Aunque `NOMGEO` exista, usá AGEEML para consistencia (incluye `NOM_ENT` y `NOM_ABR`).
- **Cobertura parcial:** no todos los asentamientos están delimitados. Por eso el endpoint tiene fallback a municipio.

---

## Lo que NO hacemos (anti-patterns)

1. **No agregar features "por las dudas"** — solo lo que la tarea actual requiere. YAGNI.
2. **No hacer wrappers/abstracciones** sobre tres líneas de código. Repetir dos veces está bien; abstraer demasiado pronto no.
3. **No introducir flags de configuración** que solo prendemos/apagamos desde código. Si el caller siempre lo usa con el mismo valor, es una constante, no un flag.
4. **No swallow errors** con `try { ... } catch {}` vacío. Si no sabés qué hacer, propagá.
5. **No usar `console.log` en código de producción** — usá `Logger`.
6. **No inventar URLs** ni importar librerías sin verificar que existen y están mantenidas.
7. **No commitear archivos de data pesados** (GeoJSONs, SHPs). Van al `.gitignore`; se regeneran con `npm run preprocess`.
8. **No committear credenciales** (`.env`, claves API). Archivo `.env` está fuera del repo.
9. **No bypasses de validación** con `// @ts-ignore` o `any` para que compile. Si TS está peleando, hay algo mal en el modelo de tipos — fixealo bien.

---

## Workflow

### Al agregar una feature

1. Identificá la capa correcta (HTTP / dominio / infra).
2. Si necesitás un service nuevo, agregalo al módulo correspondiente.
3. Si es un endpoint nuevo, creá DTOs de request/response + método en el controller + método en el service.
4. Seguí la validación estricta (class-validator en el DTO de entrada).
5. Usá excepciones built-in de Nest para respuestas de error.
6. Agregá JSDoc en clases y métodos públicos.
7. Actualizá el README si hay cambio visible para el cliente (nuevo endpoint, nuevo campo, nuevo comportamiento).

### Al agregar un estado al dataset

1. Descargá los SHPs del INEGI (Delimitación de asentamientos + Marco Geoestadístico).
2. Guardalos **bajo `data/raw/`** siguiendo la convención: `data/raw/NN_nombre_colonias/` y `data/raw/NN_nombre_geoestadistico/`.
3. **Borrá lo que no se use** dentro de esas carpetas (PDFs, XMLs, capas que no son `as` ni `mun`, catálogos duplicados). Nos quedamos solo con `NNas` + `NNmun` + sus sidecars (`.dbf`, `.shx`, `.prj`, `.cpg`) y, si querés, un metadata text file chico de contexto.
4. Agregá entradas en `scripts/preprocess.sh` (variables + bloques `ogr2ogr` + echos). Usá la variable `RAW_DIR` existente.
5. Agregá los archivos a los arrays de sources en `inegi-loader.service.ts`.
6. Re-corré `npm run preprocess` + `npm run build` + `npm start`.
7. Testeá con una coord real del nuevo estado.

### Al resolver un bug

1. **Entendé la causa raíz antes de "tapar" con un try/catch.** Si el código está tirando un error, probablemente la data o una assumption está rota.
2. Si el fix cambia behavior visible, actualizá el README.
3. Sumá un test si el bug era sutil (cuando tengamos tests, obvio).

### Commits

- **Conventional commits** (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`).
- **Sin atribución a AI** (`Co-Authored-By: Claude`, etc.). Nada.
- Mensajes cortos y concretos en la primera línea; cuerpo opcional para explicar el *por qué*.

---

## Testing (cuando los tengamos)

Por ahora no hay tests, pero la estructura está lista para recibirlos:

- **Unit tests** (`*.service.spec.ts`): mockeá las dependencies inyectadas. Testea solo la clase en cuestión.
- **Integration tests** para el loader: fijá paths de test apuntando a GeoJSONs chicos en `data/fixtures/`.
- **E2E** con `@nestjs/testing` + `supertest`: arma la app completa contra `FastifyAdapter` y testeá los endpoints.

Cuando empieces a agregar tests:

- Usá `@nestjs/testing`'s `Test.createTestingModule({ providers, controllers })`.
- Nunca mockees lo que estás testeando.
- Nombres de tests descriptivos: `it('returns 404 when point is outside all polygons', ...)`.

---

## Performance budgets

- **Boot time:** ≤ 3s con los 4 GeoJSONs actuales (~37 MB). Si pasás de eso, investigá antes de agregar features.
- **Latency p99 del endpoint:** < 10ms en una Mac moderna con rbush + turf. Si medís más de 50ms, algo está mal.
- **Memoria RSS al boot:** ~150 MB. Si crece mucho, revisá si estamos duplicando features o reteniendo buffers.

Cuando la cobertura crezca a los 32 estados (~80k polígonos), es probable que convenga migrar a PostGIS. No lo hagas antes — prematura optimización.

---

## Para agentes AI que lean este archivo

- Leé también el `README.md` para el contexto funcional.
- Si hay conflicto entre lo que dice este archivo y lo que encontrás en el código, **el código manda** — y avisá para que actualicemos este archivo.
- No modifiques `scripts/preprocess.sh` ni `data/` sin entender el flujo de reproyección Lambert→WGS84.
- No borres archivos de datos crudos del INEGI en `data/raw/` (`06_colima_*/`, `14_jalisco_*/`, `catun_municipio/`, etc.) sin confirmar con el usuario — son descargas manuales que no se regeneran solas. Los archivos auto-generados en `data/geojson/` y `data/catalogs/` sí podés borrarlos si hace falta (`npm run preprocess` los regenera).
- Antes de agregar una dependencia nueva, revisá que no haya algo similar ya instalado (ej: `@turf/turf` vs `@turf/boolean-point-in-polygon` puntual).
- Al terminar una tarea, corré el build + los curls de smoke test (ver README sección "Ejemplos de prueba") antes de reportar éxito.
