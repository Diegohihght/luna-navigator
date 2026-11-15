# Serves the API and the frontend. Works on Hugging Face Spaces (Docker SDK) and on Render.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Spaces run as a non-root user with UID 1000.
RUN useradd -m -u 1000 user
WORKDIR /home/user/app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=user . .
RUN mkdir -p data/cache && chown -R user data

USER user
EXPOSE 7860
# PORT is set by hosts such as Render; Hugging Face Spaces uses 7860.
CMD ["sh", "-c", "exec uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
