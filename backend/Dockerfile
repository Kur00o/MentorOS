# MentorOS API — self-hosting image (the hosted deployment runs on Vercel).
# Build from the repository root:  docker build -f backend/Dockerfile .
FROM python:3.12-slim
WORKDIR /srv
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
EXPOSE 8000
CMD ["sh", "-c", "python -m alembic -c backend/alembic.ini upgrade head && uvicorn backend.app.main:app --host 0.0.0.0 --port 8000"]
