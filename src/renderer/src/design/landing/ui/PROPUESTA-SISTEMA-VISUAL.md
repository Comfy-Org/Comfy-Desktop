# Propuesta: reglas y estructura visual del design system

Borrador de Mar para discutir con Pablo. Parte de una auditoría del prototipo
(`src/renderer/src/design/landing/`, 168 componentes Vue, commit `2eae4fd`).

## 1. Qué encontré

| Área | Estado hoy | Problema |
| --- | --- | --- |
| Color de texto | `subtle` 281 usos, `muted` 210, `base` 88 | El gris más apagado es el más usado: casi todo se lee con la misma (baja) jerarquía. |
| Contraste | `subtle` sobre card: 4.3:1; sobre card hover: 3.9:1 | Por debajo de AA (4.5:1) para texto de 13px. En monitores peores que el Mac se pierde. |
| Tamaños de texto | `text-ui` (13px) 577 usos; heading 31, title 24, display 8; 17 tamaños sueltos (`text-[9px]`, `10.5px`, `14px`, `15px`, `22px`, `24px`, `28px`, `30px`, `40px`) | Una sola talla hace casi todo el trabajo y los casos especiales se resuelven a mano. `text-body`, `micro` y `meta` aparecen en el README o en el código pero no existen en `tokens.css`. |
| Pesos | medium 111, semibold 83, normal 15, bold 6 | Cuatro pesos, sin regla de cuándo va cada uno. |
| Colores sueltos | ~50 usos de `bg-white/10`, `bg-black/30`, `text-white`… y 140 colores literales en 23 archivos | Fuera del sistema: no cambian con el tema. Parte es legítima (datos mock, semáforo de macOS, temas de apps). |
| Espaciado | `gap-1.5`, `gap-2.5`, `gap-3.5`, `px-2.5`… muy usados | Medios pasos (6, 10, 14px) que rompen la grilla de 4px que pide el plan. |
| Radios | `control`/`card`/`panel`/`min` + 23 valores sueltos (`1px`, `2px`, `3px`, `4px`, `7px`, `28%`) | La regla de radios anidados existe pero no se cumple en todos lados. |
| Temas | Solo dark. Los valores viven directo en `@theme`; `secondary-background` y los bordes son blanco con alfa | No hay estructura para light: el blanco con alfa no se invierte. |
| Superficies | Vidrio, panel y brillo con `oklch(...)` literales en `surfaces.css` | Hermoso pero no tematizable ni explicable como regla. |

## 2. Estructura propuesta: tres capas

```
Primitivos  ->  Semánticos (por tema)  ->  Componentes (solo si hace falta)
gray-1..12      surface-*, text-*,          button, card...
red, green,     border-*, accent            leen semánticos, nunca primitivos
amber, brand
```

1. **Primitivos.** Una rampa neutra de 12 pasos en oklch (hue 285, croma bajo,
   como hoy) más los funcionales (rojo, verde, ámbar). Un juego para dark y otro
   para light. Nadie los usa directo en features.
2. **Semánticos.** Los nombres que ya usa el código (`base-foreground`,
   `muted-foreground`, `card-background`…), apuntando a un primitivo según
   `[data-theme='dark' | 'light']`. Mismo nombre, dos valores.
3. **Componentes.** Solo cuando un rol no se puede expresar con un semántico.
   Hover y selected se derivan (`color-mix`), no son tokens nuevos.

### 2.1 Niveles de superficie (elevación)

Cuatro niveles, cada uno con fondo, borde y sombra definidos por tema:

| Nivel | Token | Dónde |
| --- | --- | --- |
| 0 · Ventana | `app-background` | Vidrio de la página, sidebar, barra de título |
| 1 · Contenido | `content-background` | Panel principal que scrollea |
| 2 · Elevado | `card-background` | Cards, inputs, controles sobre el contenido |
| 3 · Flotante | `popover-background` | Menús, popovers, diálogos, tooltips |

Regla: un elemento solo puede estar sobre su nivel o el anterior. Nada de
card sobre card sobre card.

### 2.2 Texto: tres roles con uso claro

| Rol | Uso | Mínimo de contraste |
| --- | --- | --- |
| `base-foreground` | Títulos, labels, el texto que se lee primero | 7:1 |
| `muted-foreground` | Cuerpo y descripciones (el default) | 4.5:1 |
| `subtle-foreground` | Solo metadatos (fechas, contadores, hints) | 4.5:1 sobre todos los niveles |

Cambio concreto: subir `subtle` hasta pasar 4.5:1 sobre `card-background-hover`,
y mover a `muted` los usos de `subtle` que no son metadatos.

### 2.3 Tipografía: cinco tallas, tres pesos

| Token | Tamaño / interlineado | Uso |
| --- | --- | --- |
| `text-meta` | 12 / 16 | Metadatos, badges, contadores |
| `text-ui` | 13 / 20 | Interfaz y cuerpo (default) |
| `text-heading` | 16 / 24 | Títulos de sección y de card |
| `text-title` | 22 / 28 | Título de página |
| `text-display` | 34 / 40 | Saludo de Home, hero |

Pesos: `normal` (cuerpo), `medium` (labels, botones, navegación), `semibold`
(títulos). Sin `bold`. Sin tamaños arbitrarios.

### 2.4 Espacio y forma

- **Espaciado:** grilla de 4px. Escala permitida: 4, 8, 12, 16, 24, 32, 48
  (`1, 2, 3, 4, 6, 8, 12`). Sin medios pasos.
- **Radios:** `min` 4 · `control` 8 · `card` 12 · `panel` 16 · `full` (pills y
  avatares). Radio interior = exterior − padding, nunca menos de `min`.
- **Íconos:** lucide, tres tamaños (14, 16, 20).

### 2.5 Light y dark

- Cada semántico tiene valor en los dos temas; si falta uno, no entra.
- Los colores con alfa se definen sobre el color de texto del tema
  (`color-mix(in oklab, var(--color-base-foreground) 8%, transparent)`), no
  sobre blanco fijo, así se invierten solos.
- El vidrio y los degradados pasan a tokens (`--glass-*`, `--glow-*`) con
  versión por tema. En light el vidrio se simplifica (sin mesh de color) hasta
  que lo validemos.

## 3. Reglas

1. Solo tokens semánticos en features: nada de `white/10`, `oklch()` ni hex.
2. Una superficie por nivel; ningún elemento salta niveles.
3. Un solo CTA primario (`inverted`) por pantalla.
4. `subtle` es solo para metadatos.
5. Cinco tallas de texto, tres pesos.
6. Espaciado en la grilla de 4px.
7. Radios de la escala; anidados con la regla de resta.
8. Todo token existe en light y en dark.
9. Contraste AA mínimo (4.5:1 texto, 3:1 bordes de controles) en los dos temas.
10. Hover y selected se derivan; no se crean tokens por estado.

## 4. Orden de trabajo propuesto

1. Rampa neutra y semánticos en dark, conservando el look Void (sin cambio
   visible salvo `subtle`).
2. Agregar los valores light y un switch de tema en el menú Prototype.
3. Tipografía y espaciado: reemplazar tamaños y medios pasos sueltos.
4. Limpiar colores sueltos (`white/10`, `black/30`) hacia semánticos.
5. Superficies y vidrio como tokens por tema.

## 5. Para decidir con Pablo

- ¿Esto entra en M1 o es una iteración posterior al sistema aprobado?
- ¿El vidrio y el mesh de color se mantienen en light?
- ¿Alineamos estos nombres con ComfyUI_frontend y la librería "Comfy Design
  System" de Figma para tener un solo vocabulario?
