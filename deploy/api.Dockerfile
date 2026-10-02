# The API (`backend/`): FastAPI on uvicorn, stateless except for Postgres.
# Built from the repository root: `docker build -f deploy/api.Dockerfile .`
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
COPY backend/app ./app
COPY backend/supabase ./supabase
# The presets the seed reads live in the engine, two directories up from `app/`
# in a checkout (`seed.PRESETS`); here they are copied to the same relative place.
COPY engine/compose/presets /engine/compose/presets
ENV HARNESS_PRESETS_DIR=/engine/compose/presets
RUN pip install . && adduser --disabled-password --gecos "" harness
USER harness
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers", "--forwarded-allow-ips", "*"]
