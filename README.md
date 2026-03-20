# AutoRecap — Rough Cut Generator
**Plugin UXP para Adobe Premiere Pro**

Gera automaticamente um primeiro rough cut de aftermovie/event recap a partir de música, B-roll e entrevistas. Entrega uma timeline organizada, pronta para refinamento manual.

---

## Arquitetura

```
/
├── manifest.json          Plugin manifest (UXP v5)
├── index.html             UI principal — 4 etapas
├── styles.css             Dark theme, gold accent
├── index.js               Stub (substituído pelos módulos abaixo)
└── js/
    ├── logger.js          Log panel em tempo real (nível: info/ok/warn/error/debug/ph)
    ├── state.js           Estado global + constantes (ritmo, narrativa, ticks)
    ├── premiere.js        Wrapper de toda a API do Premiere Pro
    ├── analysis.js        BPM, beat-grid, metadados de arquivo
    ├── assembly.js        Algoritmo de rough cut com estrutura narrativa
    ├── ui.js              Renderização de UI, step nav, file lists, progress
    └── main.js            Entrypoint UXP, event listeners, orquestração
```

Os scripts são carregados por `<script>` tags em ordem e compartilham o escopo global do painel — sem bundler, sem build step.

---

## Instalação e uso local

### Pré-requisitos
- Adobe Premiere Pro 26.0.2 ou superior
- [Adobe UXP Developer Tools](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/)

### Passos
1. Clone este repositório
2. Abra o **Adobe UXP Developer Tools**
3. Clique em **Add Plugin** → selecione a pasta do projeto (onde está `manifest.json`)
4. Com o Premiere Pro aberto, clique em **Load** ao lado do plugin
5. No Premiere: **Janela → Extensões → AutoRecap**

### Debug
- No UXP Developer Tools: clique em **Debug** para abrir o DevTools do painel
- O log em tempo real fica no painel de Step 4 → "Ver log"
- Entradas `[PH]` indicam código PLACEHOLDER — comportamento esperado
- Console do DevTools mostra erros não capturados

---

## Fluxo de uso

| Etapa | Ação |
|---|---|
| 1. Mídia | Selecione música, clipes B-Roll, entrevistas (opcional), assets gráficos (opcional) |
| 2. Análise | Clique "Auto-detectar BPM" ou ajuste manualmente. Confirme antes de avançar. |
| 3. Configuração | Defina duração, ritmo, frequência de cortes e extras |
| 4. Gerar | Revise o resumo e clique "Gerar Rough Cut" |

---

## Funcionalidades — O que é real vs placeholder

### ✅ 100% implementado e funcional

| Funcionalidade | Módulo |
|---|---|
| File picker (música, B-roll, entrevistas, assets) | `ui.js` + UXP Storage API |
| Import de arquivos para o projeto Premiere | `premiere.js` → `project.importFiles()` |
| Busca de itens importados no painel do projeto | `premiere.js` → busca recursiva por nome |
| Criação de nova sequência | `premiere.js` → `project.createNewSequence()` |
| Fallback para sequência ativa se criação falhar | `premiere.js` |
| Inserção de música em A1 | `premiere.js` → `track.insertClip()` |
| Distribuição de B-roll em V1 | `premiere.js` + `assembly.js` |
| Estrutura narrativa em 6 seções | `assembly.js` → `NARRATIVE_SECTIONS` |
| Anti-repetição de clipes (janela deslizante) | `assembly.js` → `makeAntiRepeatPicker()` |
| Intercalação de entrevistas por seção | `assembly.js` → `buildSectionPlan()` |
| Snap de cortes ao beat-grid (BPM manual) | `analysis.js` → `snapDurationToBeat()` |
| Nomeação de tracks (B-Roll, Entrevistas, Música) | `premiere.js` → `track.name` |
| Labels de cor por tipo de mídia | `premiere.js` → `clip.label` |
| Markers de seção narrativa | `premiere.js` → `sequence.markers` |
| Marker de title card inicial | `premiere.js` → `createTitleCardMarker()` |
| Marker de cartela final | `premiere.js` → `createEndCardMarker()` |
| Log panel em tempo real | `logger.js` |
| BPM manual via slider + input numérico | `main.js` + `ui.js` |

### ⚠️ Placeholder — documentado, não funcional

| Funcionalidade | Razão | Local no código |
|---|---|---|
| Auto-detecção de BPM real | Web Audio API indisponível no UXP do Premiere; retorna 120 BPM | `analysis.js` → `simulateBpmDetection()` |
| Duração real da música | Metadados de áudio não expostos pela API UXP | `state.js` → `MUSIC_DURATION_FALLBACK` |
| Trim preciso de clipes por ritmo | `clip.end` pode não estar acessível; tenta aplicar, avisa se falhar | `premiere.js` → `insertVideoClip()` |
| Formato 9:16 / 1:1 | `createNewSequence()` usa preset padrão; ajuste manual necessário | `main.js` listener `cfg-format` |
| Cartelas de título/fim como gráfico | API UXP não suporta inserção de Mogrt; cria apenas marker | `premiere.js` → `createTitleCardMarker/EndCardMarker()` |
| Assets gráficos na timeline | Importação funciona; posicionamento automático não implementado | `main.js` → `btn-select-assets` |

### 🔵 Extension points — preparados para o futuro

| Funcionalidade | Onde implementar |
|---|---|
| Análise de estabilidade de imagem | `assembly.js` → `analyzeClips()` |
| Detecção de rosto / emoção / ação | `assembly.js` → `analyzeClips()` |
| Score de qualidade por clipe | `assembly.js` → `analyzeClips()` |
| Seleção automática de in/out points | `assembly.js` → `analyzeClips()` + `premiere.js` → `insertVideoClip()` |
| Transcrição de fala | Novo módulo `transcription.js`, integrar em `buildSectionPlan()` |
| Sincronização real com beats de áudio | `analysis.js` → substituir `simulateBpmDetection()` por engine real |
| Sugestão de selects | `assembly.js` → novo método `suggestSelects()` |

---

## Estrutura narrativa padrão

```
Abertura    10%  → 2-4 cortes rápidos (punch), snap ao beat
Introdução  10%  → planos mais longos (medium), estabelece o clima
Bloco A     25%  → alternância ação/detalhe/público, entrevistas opcionais
Bloco B     20%  → mais dinâmico, entrevistas opcionais
Bloco C     15%  → construção de tensão (build), entrevistas opcionais
Fechamento  20%  → planos impactantes (punch), snap ao beat, logo marker
```

Cada seção recebe um marker na timeline. Os percentuais e estilos são configuráveis em `js/state.js → NARRATIVE_SECTIONS`.

---

## Limitações conhecidas

1. **Trim de clipes**: se `clip.end` não estiver acessível na versão do Premiere, os clipes são inseridos em comprimento integral. O log mostrará `[PH] Trim não suportado`. Uma solução alternativa é usar `overwriteClip` com in/out points — pendente de implementação.

2. **Sequência**: `createNewSequence('', '')` pode falhar dependendo da configuração do Premiere. O plugin usa a sequência ativa como fallback.

3. **Localização de itens importados**: a busca é feita por nome de arquivo. Se o Premiere importar o arquivo em uma estrutura de bins diferente da esperada, o item pode não ser localizado. Solução: mova os arquivos para a raiz do painel de projeto.

4. **Número máximo de clipes**: o algoritmo tem um limite de 500 clips por plan para evitar loops infinitos. Planos muito longos com clipes muito curtos podem ser truncados.

---

## Calibração do algoritmo

Edite `js/state.js` para ajustar:

- `RHYTHM_PRESETS` — durações mínimas/máximas por estilo de clip
- `CUT_FREQ_MULTIPLIER` — multiplicadores de frequência
- `NARRATIVE_SECTIONS` — proporções e estilos de cada seção
- `INTERVIEW_MAX_PCT` — percentual máximo de entrevistas por seção
- `INTERVIEW_CLIP_DURATION` — duração padrão de um trecho de entrevista
