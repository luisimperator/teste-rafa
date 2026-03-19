# Rough Cut Generator — Premiere Pro UXP Plugin

Plugin UXP para Premiere Pro que gera um rough cut básico de aftermovie de evento automaticamente.

## Funcionalidades implementadas

| Feature | Status |
|---|---|
| Importar música para o projeto | ✅ Implementado |
| Selecionar clipes B-Roll via file picker | ✅ Implementado |
| Selecionar entrevistas (opcional) | ✅ Implementado |
| Escolher duração final | ✅ Implementado |
| Escolher ritmo (rápido / médio / lento) | ✅ Implementado |
| Criar sequência nova no Premiere | ✅ Implementado |
| Inserir música na faixa de áudio (A1) | ✅ Implementado |
| Distribuir clipes B-Roll na timeline (V1) | ✅ Implementado |
| Intercalar entrevistas no corte | ✅ Implementado |
| Markers para cartela de título e cartela final | ✅ Implementado |

## Placeholders — não implementados nesta versão

| Feature | Motivo |
|---|---|
| **Duração "Seguir música"** | Análise de metadados de áudio (duração real) não disponível via UXP sem lib externa. Usa fallback de 3 min. |
| **Beat detection / sincronismo com BPM** | Requer análise de áudio em tempo real — fora do escopo da API UXP. |
| **Trim preciso por ritmo** | `clip.end` pode não estar acessível em todas as versões da API UXP do Premiere. O plugin tenta aplicar, mas registra aviso se falhar. |
| **Cartela de título real (gráfico)** | Criação de gráfico/Mogrt via API UXP não é diretamente suportada. Adicionado como marker na timeline. |
| **Cartela final real (gráfico)** | Mesmo motivo acima. |
| **Seleção inteligente de trecho do clipe** | In/out automático baseado em conteúdo requer análise de vídeo (IA). |
| **Colorização automática** | Não existe API UXP pública para aplicar LUTs/correção de cor automaticamente. |

## Requisitos

- Adobe Premiere Pro 26.0.2 ou superior
- Adobe UXP Developer Tools

## Instalação (desenvolvimento)

1. Clone este repositório na sua máquina
2. Abra o **Adobe UXP Developer Tools**
3. Clique em **Add Plugin** e selecione a pasta do projeto
4. Com o Premiere Pro aberto, clique em **Load**

## Uso

1. **Música** — selecione o arquivo de áudio do aftermovie
2. **B-Roll** — adicione os clipes de vídeo (pode selecionar múltiplos)
3. **Entrevistas** — opcional, intercaladas automaticamente no corte
4. **Duração** — escolha a duração total do vídeo
5. **Ritmo** — define a duração média de cada corte na timeline
6. **Gerar** — clique em "Gerar Rough Cut" e aguarde

O rough cut será criado em uma nova sequência chamada **"Rough Cut - HH:MM"** no projeto ativo do Premiere Pro.
