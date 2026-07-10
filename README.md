---
title: Ontology Chatbot
emoji: 🤖
colorFrom: purple
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# Ontology Chatbot

Haro, a robotic-librarian chatbot backed by a knowledge-graph service (RDF/SPARQL over `pyoxigraph`) and multi-provider LLM chat (LM Studio, OpenRouter, Google Gemini).

This Space packages three components into one container:

- **kg-service** — RDF store, tabular ingestion, embedding-based entity linking (internal only, `127.0.0.1:8001`)
- **chatbot-server** — chat API, history, settings (public, serves this Space's traffic)
- **chatbot-ui** — React frontend, built at image-build time and served statically by chatbot-server

## Required secrets

Set these in the Space's **Settings → Variables and secrets**:

| Name | Purpose |
|---|---|
| `GEMINI_API_KEY` | Chat via Google Gemini, and required for embedding-based entity matching (kg-service). Get one free at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). |
| `EMBEDDING_API_KEY` | Same value as `GEMINI_API_KEY` — kg-service reads it under its own name. |
| `OPENROUTER_API_KEY` | Optional — enables the OpenRouter chat provider. |

See [chatbot-server/.env.example](chatbot-server/.env.example) and [kg-service/.env.example](kg-service/.env.example) for the full list of configurable variables.
