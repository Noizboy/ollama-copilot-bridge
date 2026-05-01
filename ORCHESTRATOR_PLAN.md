# Ollama Bridge Auto Orchestrator

## Idea General

Auto Orchestrator seria un modelo virtual dentro de Ollama Copilot Bridge.

En el selector de modelos de Copilot apareceria algo como:

```txt
Ollama Bridge: Auto Orchestrator
```

El usuario selecciona ese unico modelo, pero internamente la extension decide que LLM usar en cada fase:

```txt
Usuario
-> Auto Orchestrator
-> Analyzer
-> Planner Model
-> Implementer Model
-> Reviewer Model
-> Respuesta final / tool calls
```

La extension no reemplaza los Agents de GitHub Copilot. Los complementa.

```txt
Copilot Agent = define el rol y comportamiento
Auto Orchestrator = decide que modelo usar internamente
```

Ejemplo:

```txt
PM-Agent + Ollama Bridge: Auto Orchestrator
```

PM-Agent define el tipo de trabajo. Auto Orchestrator decide si usa un modelo para planear, otro para implementar y otro para revisar.

## Uso Practico

1. Instalar la extension.

```powershell
code --install-extension .\ollama-copilot-bridge-0.0.3.vsix --force
```

2. Recargar VS Code.

3. Configurar la API key:

```txt
Ollama Copilot: Set API Key
```

4. Configurar modelos del orquestador:

```json
{
  "ollamaCopilot.orchestrator.enabled": true,
  "ollamaCopilot.orchestrator.mode": "balanced",
  "ollamaCopilot.orchestrator.simpleModel": "gemma3:12b",
  "ollamaCopilot.orchestrator.plannerModel": "deepseek-v4-pro",
  "ollamaCopilot.orchestrator.implementerModel": "kimi-k2.6",
  "ollamaCopilot.orchestrator.reviewerModel": "gpt-oss:120b",
  "ollamaCopilot.orchestrator.toolModel": "deepseek-v4-pro"
}
```

5. En Copilot Chat seleccionar:

```txt
Ollama Bridge: Auto Orchestrator
```

6. Usar Agent mode normalmente.

Ejemplo:

```txt
Refactoriza este modulo, separa la logica de autenticacion, agrega tests y ejecuta la suite.
```

Internamente:

```txt
Analyzer: complex
Planner: deepseek-v4-pro
Implementer: kimi-k2.6
Reviewer: gpt-oss:120b
Tool model: deepseek-v4-pro si hacen falta tools
```

El usuario solo ve una conversacion normal.

## Rutas De Ejecucion

### Tarea Simple

Ejemplo:

```txt
Corrige este typo en README.
```

Ruta:

```txt
User -> simpleModel -> final
```

### Tarea Media

Ejemplo:

```txt
Agrega una configuracion nueva y actualiza el README.
```

Ruta:

```txt
User -> plannerModel -> implementerModel -> final
```

### Tarea Compleja

Ejemplo:

```txt
Reestructura el provider para soportar multi-endpoint, tests y fallback.
```

Ruta:

```txt
User -> plannerModel -> implementerModel -> reviewerModel -> final
```

### Tarea Riesgosa

Ejemplo:

```txt
Modifica autenticacion, secretos, permisos o ejecucion de comandos.
```

Ruta:

```txt
User -> plannerModel -> implementerModel -> reviewerModel -> tests -> final
```

## Clasificador De Complejidad

El Analyzer decide la ruta segun la tarea.

Criterios:

```txt
simple:
- cambio pequeño
- un archivo
- no requiere tests
- no requiere tools complejas

medium:
- varios archivos
- configuracion nueva
- cambios de UI pequeños
- tests recomendados

complex:
- refactor
- arquitectura
- varios modulos
- cambios de provider/API
- requiere plan

risky:
- auth
- secretos
- seguridad
- comandos/terminal
- datos sensibles
- cambios destructivos
```

Tambien puede detectar overrides manuales en el prompt:

```txt
Usa modo fast
Usa modo thorough
Usa solo Kimi
Usa planner fuerte
No revises
```

## Configuracion Recomendada

```json
{
  "ollamaCopilot.orchestrator.enabled": true,
  "ollamaCopilot.orchestrator.mode": "balanced",
  "ollamaCopilot.orchestrator.maxSteps": 3,
  "ollamaCopilot.orchestrator.maxPlanningTokens": 1500,
  "ollamaCopilot.orchestrator.maxReviewTokens": 1000,
  "ollamaCopilot.orchestrator.showTraceInChat": true,
  "ollamaCopilot.orchestrator.autonomy": "ask-before-tools",
  "ollamaCopilot.orchestrator.simpleModel": "gemma3:12b",
  "ollamaCopilot.orchestrator.plannerModel": "deepseek-v4-pro",
  "ollamaCopilot.orchestrator.plannerFallbackModel": "gpt-oss:120b",
  "ollamaCopilot.orchestrator.implementerModel": "kimi-k2.6",
  "ollamaCopilot.orchestrator.implementerFallbackModel": "deepseek-v4-pro",
  "ollamaCopilot.orchestrator.reviewerModel": "gpt-oss:120b",
  "ollamaCopilot.orchestrator.toolModel": "deepseek-v4-pro"
}
```

## Modos

### fast

Menos pasos. Menos costo y latencia.

```txt
simple -> simpleModel
medium -> implementerModel
complex -> plannerModel -> implementerModel
```

### balanced

Balance entre calidad y velocidad.

```txt
simple -> simpleModel
medium -> plannerModel -> implementerModel
complex -> plannerModel -> implementerModel -> reviewerModel
```

### thorough

Mas lento, pero mas cuidadoso.

```txt
simple -> implementerModel
medium -> plannerModel -> implementerModel -> reviewerModel
complex -> plannerModel -> implementerModel -> reviewerModel -> tests
risky -> plannerModel -> reviewerModel -> implementerModel -> reviewerModel -> tests
```

## Tool Calling

Auto Orchestrator debe controlar que fases pueden usar herramientas.

Regla recomendada:

```txt
Analyzer: no tools
Planner: read-only tools opcional
Implementer: tools enabled
Reviewer: read-only tools + terminal tests
```

Si el modelo seleccionado para implementar no soporta tools:

```txt
1. Intentar implementerModel
2. Si no devuelve tool_calls, usar toolModel
3. Si toolModel falla, responder con plan/manual steps
```

La extension ya debe convertir:

```txt
OpenAI/Ollama tool_calls -> VS Code LanguageModelToolCallPart
VS Code LanguageModelToolResultPart -> OpenAI role: tool
```

VS Code/Copilot sigue controlando la ejecucion real de herramientas y confirmaciones.

## Logs Y Trazabilidad

El Output Channel deberia mostrar:

```txt
[Orchestrator] phase=analyze model=gemma3:12b status=ok duration=1.2s
[Orchestrator] complexity=complex route=planner->implementer->reviewer
[Orchestrator] phase=plan model=deepseek-v4-pro status=ok duration=5.8s
[Orchestrator] phase=implement model=kimi-k2.6 status=tool_call runCommand
[Orchestrator] phase=review model=gpt-oss:120b status=ok duration=7.1s
```

Comando recomendado:

```txt
Ollama Copilot: Show Orchestrator Trace
```

Opcion para mostrar una linea en el chat:

```txt
Using: Planner DeepSeek V4 Pro -> Coder Kimi K2.6 -> Reviewer GPT-OSS 120B
```

Configurable con:

```json
{
  "ollamaCopilot.orchestrator.showTraceInChat": true
}
```

## Desventajas Y Soluciones

### 1. Mas Latencia

Problema:

```txt
analyzer -> planner -> implementer -> reviewer
```

puede tardar mas.

Solucion:

```txt
fast mode
clasificacion por complejidad
saltar planner/reviewer en tareas simples
maxSteps
```

### 2. Mas Costo O Uso De Cuota

Problema: varias llamadas consumen mas tokens.

Solucion:

```json
{
  "ollamaCopilot.orchestrator.maxSteps": 3,
  "ollamaCopilot.orchestrator.maxPlanningTokens": 1500,
  "ollamaCopilot.orchestrator.maxReviewTokens": 1000
}
```

### 3. Perdida De Coherencia Entre Modelos

Problema: el planner dice una cosa y el implementer entiende otra.

Solucion: convertir el plan en contrato.

Formato:

```txt
Goal:
Files:
Steps:
Constraints:
Tests:
Do not:
```

El implementer recibe:

```txt
Implement exactly this plan.
Do not change unrelated files.
If a step is impossible, explain why.
```

### 4. Tool Calling Desordenado

Problema: cualquier fase podria intentar ejecutar tools.

Solucion:

```txt
toolsEnabled = phase === "implement" || phase === "review"
```

### 5. Debug Dificil

Problema: muchas piezas pueden fallar.

Solucion:

```txt
Output trace
duracion por fase
modelo usado por fase
status por fase
ultimo error por fase
```

### 6. Confusion Porque El Selector No Cambia

Problema: el usuario ve solo:

```txt
Ollama Bridge: Auto Orchestrator
```

Solucion:

```txt
showTraceInChat
Show Orchestrator Trace command
Output Channel logs
```

### 7. Modelos Sin Tool Calling Real

Problema: algunos modelos dicen soportar tools pero no devuelven `tool_calls`.

Solucion:

```txt
toolModel dedicado
fallback si no hay tool_calls
capability checks
lista local de modelos confiables
```

### 8. Fallos De Modelo Intermedio

Problema: planner/implementer/reviewer puede fallar por timeout, 503 o overload.

Solucion:

```json
{
  "ollamaCopilot.orchestrator.plannerFallbackModel": "gpt-oss:120b",
  "ollamaCopilot.orchestrator.implementerFallbackModel": "deepseek-v4-pro"
}
```

Reglas:

```txt
planner falla -> usar plannerFallback
implementer falla -> usar implementerFallback
reviewer falla -> continuar sin reviewer
```

### 9. Demasiada Autonomia

Problema: el orquestador podria hacer mas de lo esperado.

Solucion:

```json
{
  "ollamaCopilot.orchestrator.autonomy": "ask-before-tools"
}
```

Opciones:

```txt
chat-only = solo responde
ask-before-tools = pide confirmacion antes de tools
agent = usa tools como Agent mode permita
```

### 10. Mala Eleccion De Modelo

Problema: el clasificador puede equivocarse.

Solucion:

```txt
override manual en prompt
settings por fase
fallback por fase
logs para revisar decisiones
```

## MVP Recomendado

Primera version:

```txt
Auto Orchestrator
├─ mode: fast | balanced | thorough
├─ maxSteps
├─ simpleModel
├─ plannerModel
├─ implementerModel
├─ reviewerModel
├─ toolModel
├─ fallbackModels
├─ showTraceInChat
└─ output trace
```

Sin UI avanzada inicialmente. Solo settings JSON, logs y tests.

Despues agregar:

```txt
Ollama Copilot: Configure Orchestrator
```

con un menu para escoger modelos disponibles.

## Plan De Implementacion

### Fase 1: Configuracion

- Agregar settings del orquestador en `package.json`.
- Crear tipos `OrchestratorConfig`.
- Leer config desde `src/config.ts`.

### Fase 2: Modelo Virtual

- Agregar `Ollama Bridge: Auto Orchestrator` a la lista de modelos.
- Marcarlo con `id: auto-orchestrator`.
- No enviarlo directamente a Ollama.

### Fase 3: Analyzer

- Crear modulo `src/orchestrator/analyzer.ts`.
- Clasificar complejidad con heuristicas locales.
- Opcional: usar `simpleModel` para clasificacion avanzada.

### Fase 4: Pipeline

- Crear `src/orchestrator/orchestrator.ts`.
- Implementar rutas:

```txt
simple -> simpleModel
medium -> planner -> implementer
complex -> planner -> implementer -> reviewer
risky -> planner -> implementer -> reviewer + tests
```

### Fase 5: Cliente Interno

- Agregar a `OllamaClient` un metodo para request no-stream o stream acumulado.
- Permitir llamadas internas por fase.

### Fase 6: Tool Calling

- Reusar `openAiStream.ts`.
- Emitir tool calls solo desde fases autorizadas.
- Reenviar tool results al modelo correcto.

### Fase 7: Trazabilidad

- Agregar logs por fase.
- Agregar comando `Ollama Copilot: Show Orchestrator Trace`.
- Agregar `showTraceInChat`.

### Fase 8: Tests

Tests recomendados:

```txt
clasifica tarea simple
clasifica tarea compleja
elige ruta segun modo
usa fallback si falla planner
usa toolModel si implementer no soporta tools
no duplica tool results
genera trace
```

## Resultado Esperado

El usuario trabaja asi:

```txt
1. Selecciona PM-Agent, Backend-Agent, Reviewer-Agent, etc.
2. Selecciona Ollama Bridge: Auto Orchestrator como modelo.
3. Pide la tarea normalmente.
4. La extension decide que LLM usar por fase.
5. Copilot/VS Code ejecuta tools si corresponde.
6. El usuario recibe una respuesta final con plan, cambios o tool calls.
```

Los Agents de Copilot siguen sirviendo. Auto Orchestrator solo mejora la seleccion interna de modelos.
