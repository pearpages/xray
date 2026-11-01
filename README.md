# 🩻 xray

Análisis de Pull Requests para proyectos TypeScript/React. Compara la rama actual con la rama base y
genera un informe en Markdown (con diagramas Mermaid) que una GitHub Action publica como **un único
comentario** en el PR, actualizado en cada push.

## Estructura

| Paquete                            | Qué es                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| [`packages/core`](packages/core)   | Núcleo reutilizable: diff de git, análisis y render. Devuelve datos (`XrayResult`) y Markdown. |
| [`packages/cli`](packages/cli)     | CLI `xray [base]`, un único comando.                                                      |
| [`packages/action`](packages/action) | Publica o actualiza el comentario del PR (busca el marcador `<!-- xray:report -->`).     |
| [`action.yml`](action.yml)         | GitHub Action compuesta que construye xray, ejecuta el CLI y comenta.                     |

El núcleo no sabe nada de GitHub ni de la CLI: la futura herramienta de calidad de proyecto puede
llamar a `analyzePullRequest()` y usar el JSON directamente.

## CLI

```bash
npm ci && npm run build
node packages/cli/dist/index.js main --cwd ../mi-proyecto
```

```
xray [base]            rama base del PR (por defecto main; también prueba origin/<base>)
  -C, --cwd <dir>      raíz del repositorio a analizar
  -f, --format <fmt>   markdown | json
  -o, --out <file>     escribe el informe en un archivo
  -c, --config <file>  config, relativo a --cwd (por defecto xray.config.json)
```

En local el diff incluye también los cambios sin commitear y los archivos nuevos sin seguimiento.

## GitHub Action

```yaml
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  xray:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # necesario para calcular el merge-base con la rama base
      - uses: pearpages/xray@main
        # with:
        #   working-directory: apps/web
        #   config: xray.config.json
        #   comment: "false"   # solo genera el informe (también va al job summary)
```

El informe también se añade al *job summary* y queda disponible en el output `report-path`.
En PRs desde forks el `GITHUB_TOKEN` es de solo lectura y el comentario fallará.

## Configuración (`xray.config.json`)

Todos los campos son opcionales:

```json
{
  "roots": ["src"],
  "tsConfig": "tsconfig.json",
  "exclude": ["(^|/)node_modules/", "(^|/)(dist|build|coverage|\\.next)/"],
  "dependencies": { "maxNodes": 60, "includeExternal": false }
}
```

- `roots`: carpetas que recorre dependency-cruiser (por defecto `src` si existe, si no `.`).
- `tsConfig`: se usa para resolver alias (`@/…`); por defecto `tsconfig.json` si existe.
- `dependencies.maxNodes`: límite de nodos del diagrama; se priorizan los vecinos conectados a más
  módulos cambiados y se indica cuántos se omiten.
- `dependencies.includeExternal`: muestra paquetes npm y módulos de Node como vecinos.

## Análisis

1. **Dependencias** ✅ — archivos cambiados (`git diff` contra el merge-base) más sus vecinos directos
   (lo que importan y lo que los importa) según dependency-cruiser, en un diagrama Mermaid agrupado por
   carpeta con los módulos cambiados resaltados. Distingue imports de solo tipos, imports dinámicos y
   tests.
2. **Interacciones** — ts-morph: funciones/componentes tocados → referencias hacia arriba hasta puntos de
   entrada y 1-2 niveles hacia abajo → diagramas de secuencia por funcionalidad, con un mapa de
   funcionalidades versionado en el repo.
3. **Impacto y riesgo** — cobertura × complejidad → semáforo.
4. **API pública / contratos** — diff de exports y endpoints, compatible/rompedor, usos afectados.
5. **Bundle size** — build de base y PR, chunks gzip/brotli, umbral configurable y causa.

Después: un skill de Claude sobre el CLI que explique diagramas y riesgos.

## Desarrollo

```bash
npm ci
npm run build
npm test -- --run
```

Node 24 (fijado en `mise.toml`). `typescript` está en la serie 6: dependency-cruiser aún no admite
TypeScript 7 (`>=2 <7`) y sin él no analiza `.ts`/`.tsx`.
