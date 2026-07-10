# --- Stage 1: build the React frontend -------------------------------------
FROM node:22-slim AS frontend-builder

WORKDIR /app/chatbot-ui
COPY chatbot-ui/package.json chatbot-ui/package-lock.json ./
RUN npm ci
COPY chatbot-ui/ ./
RUN npm run build

# --- Stage 2: Python runtime (kg-service + chatbot-server) -----------------
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY kg-service/ ./kg-service/
COPY chatbot-server/ ./chatbot-server/
COPY --from=frontend-builder /app/chatbot-ui/dist ./chatbot-server/static/
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

ENV APP_ENV=production \
    KG_SERVICE_URL=http://127.0.0.1:8001 \
    EMBEDDING_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/ \
    EMBEDDING_MODEL=gemini-embedding-001

EXPOSE 7860

CMD ["./start.sh"]
